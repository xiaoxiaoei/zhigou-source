import express from "express";
import multer from "multer";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseTeachingDocument, DOCUMENT_FORMATS, officeBinary, convertOffice } from "./src/document-parser.mjs";
import { analyzeDeck } from "./src/analyzer.mjs";
import { createLlmClientFromEnv } from "./src/llm-client.mjs";
import { textSourceToDeck } from "./src/text-source-parser.mjs";
import { AnalysisJobStore } from "./src/job-store.mjs";
import { runTeachingTask } from "./src/teaching-task.mjs";
import { createMotionDraft, publicMotionDraft } from './src/motion-draft.mjs';
import { selectDeckPages } from './src/page-selection.mjs';
import { extractOutlineUnits } from './src/course-outline.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);
const maxPptxSizeMb = Number(process.env.MAX_PPTX_SIZE_MB || 50);
const maxPptxSizeBytes = maxPptxSizeMb * 1024 * 1024;
const maxSlideCount = Number(process.env.MAX_PPTX_SLIDES || 200);
const maxExtractedTextChars = Number(process.env.MAX_PPTX_TEXT_CHARS || 250000);
const settingsFile = path.join(__dirname, ".data", "model-settings.json");
await loadSettings(settingsFile);
let modelClient = createLlmClientFromEnv();
const jobStore = new AnalysisJobStore({
  directory: process.env.JOB_DATA_DIR || path.join(__dirname, ".data", "analysis-jobs"),
  retentionMs: Number(process.env.JOB_RETENTION_DAYS || 7) * 24 * 60 * 60 * 1000,
});
const motionRevisionJobStore = new AnalysisJobStore({
  directory: process.env.MOTION_JOB_DATA_DIR || path.join(__dirname, ".data", "motion-revision-jobs"),
  retentionMs: Number(process.env.JOB_RETENTION_DAYS || 7) * 24 * 60 * 60 * 1000,
  interruption: {
    code: "MOTION_REVISION_INTERRUPTED",
    title: "动效修改因服务重启而中断",
    detail: "当前版本保持不变，系统不会自动重放可能产生费用的请求。",
    message: "本地服务在动效修改期间重启，本次任务已安全停止。",
    recovery: "当前版本已保留。请确认修改要求后由教师手动重试。",
  },
});
const restoredJobs = await jobStore.init();
const restoredMotionRevisionJobs = await motionRevisionJobStore.init();
const analysisJobs = new Map(restoredJobs.map((job) => [job.id, job]));
const motionRevisionJobs = new Map(restoredMotionRevisionJobs.map((job) => [job.id, job]));
const persistenceQueues = new Map();

function persistJob(job) {
  const previous = persistenceQueues.get(job.id) || Promise.resolve();
  const next = previous.catch(() => {}).then(() => jobStore.save(job));
  persistenceQueues.set(job.id, next);
  void next.then(
    () => { if (persistenceQueues.get(job.id) === next) persistenceQueues.delete(job.id); },
    (error) => {
      if (persistenceQueues.get(job.id) === next) persistenceQueues.delete(job.id);
      console.error(`保存分析任务 ${job.id} 失败`, error);
    },
  );
  return next;
}

function recordJobProgress(job, progress) {
  if(job.cancelled && progress.phase!=="failed")return;
  job.progress = progress;
  job.events.push(progress);
  if (job.events.length > 60) job.events.splice(0, job.events.length - 60);
  void persistJob(job);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxPptxSizeBytes, files: 1 },
  fileFilter(_req, file, callback) {
    const supported = DOCUMENT_FORMATS.includes(path.extname(file.originalname).toLowerCase());
    callback(supported ? null : new Error("请选择 PPT、PPTX、DOC、DOCX 或 PDF 文件"), supported);
  },
});

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use("/vendor/phosphor", express.static(path.join(__dirname, "node_modules/@phosphor-icons/web/src")));
app.use('/vendor/pdfjs',express.static(path.join(__dirname,'node_modules/pdfjs-dist')));
app.use('/vendor/katex',express.static(path.join(__dirname,'node_modules/katex/dist')));
app.use(express.static(path.join(__dirname, "public")));

installSettings(app,{file:settingsFile,onChange:client=>{modelClient=client;},isBusy:()=>[...analysisJobs.values(),...motionRevisionJobs.values()].some(j=>j.state==="running")});
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "ppt-knowledge-motion-demo",
    maxPptxSizeMb,
    maxSlideCount,
    maxExtractedTextChars,
    model: modelClient.model,
    runtime: modelClient.runtime,
    semanticPlanner: modelClient.configured ? "llm-required-ready" : "llm-required-unconfigured",
    durableJobs: true,
    restoredJobs: restoredJobs.length,
  });
});

app.get("/api/capabilities", async (_req, res) => {
  res.json({
    formats: DOCUMENT_FORMATS,
    officeConversionReady: !!await officeBinary(),
    maxPptxSizeMb,
    maxPptxSizeBytes,
    maxSlideCount,
    maxExtractedTextChars,
    modelRequired: true,
    modelReady: modelClient.configured,
    model: modelClient.model,
    models: {
      extraction: process.env.LLM_FAST_MODEL || modelClient.model,
      reasoning: process.env.LLM_REASONING_MODEL || modelClient.model,
      visualPlanning: process.env.LLM_VISUAL_PLANNER_MODEL || process.env.LLM_VISUAL_MODEL || modelClient.model,
      rendering: process.env.LLM_RENDER_MODEL || process.env.LLM_VISUAL_MODEL || modelClient.model,
    },
    runtime: modelClient.runtime,
    jobRecovery: "disk-checkpoints",
    stages: ["evidence-chunks", "generated-outline", "per-knowledge-analysis", "cross-point-curation", "lesson-plan", "visual-blueprint", "svg-render"],
  });
});

function totalDeckTextLength(deck) {
  return deck.slides.reduce((total, slide) => total + String(slide.text || "").length + String(slide.notes || "").length, 0);
}

function createInputLimitError(message, code) {
  const error = new Error(message);
  error.code = code;
  error.status = 413;
  return error;
}

function startAnalysisJob(deck, analysisRequest, res, initialDetail = "正在创建 AI 分析任务") {
  const jobId = randomUUID();
  const job = {
    id: jobId, state: "running", createdAt: new Date().toISOString(), deck,
    progress: { phase: "preparing", title: "正在准备分析", detail: initialDetail },
    events: [{ at: new Date().toISOString(), phase: "preparing", title: "备课单元已创建", detail: initialDetail }],
    model: modelClient.model, runtime: modelClient.runtime,
  };
  analysisJobs.set(jobId, job);
  void persistJob(job);
  res.status(202).json({ jobId, model: job.model, runtime: job.runtime });
  void analyzeDeck(deck, {
    analysisRequest, useLlm: true, llmClient: cancellableClient(modelClient, job), deferMotion: true,
    onProgress(progress) { recordJobProgress(job, progress); },
    onCheckpoint(checkpoint) { if(job.cancelled)return; job.partialResult = { deck, analysis: checkpoint.analysis, checkpoint: checkpoint.stage }; void persistJob(job); },
  }).then((analysis) => {
    if(job.cancelled)return;
    analysis.warnings = [...(deck.importWarnings || []), ...(analysis.warnings || [])];
    job.state = "completed"; job.result = { deck, analysis }; recordJobProgress(job, { at: new Date().toISOString(), phase: "complete", title: "备课包已生成", detail: "结果已准备好" });
  }).catch((error) => { if(job.cancelled)return; job.state = "failed"; job.error = { code: error?.code || "ANALYSIS_FAILED", message: error?.message || "分析失败", status: Number(error?.status || 500), requestId: error?.requestId || null, providerCode: error?.providerCode || null, attempt: error?.attempt || null }; recordJobProgress(job, { at: new Date().toISOString(), phase: "failed", title: "分析任务停止", detail: `${job.error.message}${job.error.requestId ? ` · Request ID ${job.error.requestId}` : ""}` }); });
}

let parsingDocuments = 0;
const importedMaterials=new Map();
function pruneImports(){for(const [id,item]of importedMaterials)if(Date.now()-item.at>3600000)importedMaterials.delete(id);}
app.post('/api/material-preview',upload.single('pptx'),async(req,res,next)=>{
  if(parsingDocuments>=2)return res.status(429).json({error:'已有材料正在解析，请稍后再试'});
  parsingDocuments++;
  try{
    if(!req.file)return res.status(400).json({error:'请选择文件'});
    
    const raw=req.file.originalname,decoded=Buffer.from(raw,'latin1').toString('utf8'),filename=/[^\u0000-\u00ff]/.test(raw)||decoded.includes('\ufffd')?raw:decoded;
    const deck=await parseTeachingDocument(req.file.buffer,filename,{maxPages:1000,maxCharacters:2000000,allowEmpty:true});
    pruneImports();while(importedMaterials.size>=5)importedMaterials.delete(importedMaterials.keys().next().value);
    const materialId=randomUUID();importedMaterials.set(materialId,{deck,buffer:req.file.buffer,at:Date.now()});
    res.json({materialId,filename,sourceUnit:deck.sourceUnit||"page",sourceFormat:deck.sourceFormat,totalPages:deck.slideCount,maxSelectedPages:maxSlideCount,maxCharacters:maxExtractedTextChars,pages:deck.slides.map(s=>({number:s.number,title:s.title,text:(s.text||''),characters:(s.text||'').length+(s.notes||'').length}))});
  }catch(error){next(error);}finally{parsingDocuments--;}
});
let renderingPreviews=0;
let outlineBusy=false;
app.post('/api/course-outline',async(req,res,next)=>{
  if(outlineBusy)return res.status(429).json({error:'正在识别另一份大纲，请稍候'});
  try{outlineBusy=true;const units=await extractOutlineUnits(req.body.text,modelClient,req.body.granularity);res.json({units});}
  catch(error){res.status(422).json({error:error.message||'大纲识别失败'});}
  finally{outlineBusy=false;}
});
let ocrBusy=false;
app.post('/api/material-preview/:id/ocr',async(req,res,next)=>{
  if(ocrBusy)return res.status(429).json({error:'正在识别其他材料，请稍后重试'});
  try{const material=importedMaterials.get(req.params.id);if(!material)return res.status(410).json({error:'材料已过期，请重新上传'});
    const selected=selectDeckPages(material.deck,req.body.pageRange,{maxPages:20,maxCharacters:2000000,allowEmpty:true});ocrBusy=true;
    const isSlides=['ppt','pptx'].includes(material.deck.sourceFormat);
    const buffer=isSlides?(material.pdf||await convertOffice(material.buffer,'.'+material.deck.sourceFormat,'pdf')):material.buffer;
    const pages=await recognizePages(buffer,isSlides?'.pdf':'.'+material.deck.sourceFormat,selected.slides.map(p=>p.number));res.json({pages});
  }catch(error){next(error);}finally{ocrBusy=false;}
});
app.get('/api/material-preview/:id/image',(req,res)=>{const m=importedMaterials.get(req.params.id);if(!m||m.deck.sourceMode!=='image')return res.sendStatus(404);res.set('Cache-Control','no-store').type(m.deck.sourceFormat==='png'?'image/png':'image/jpeg').send(m.buffer);});
app.get('/api/material-preview/:id/document.pdf',async(req,res,next)=>{
  try{
    pruneImports();const material=importedMaterials.get(req.params.id);
    if(!material)return res.status(410).json({error:'预览已过期，请重新上传'});
    if(!material.pdf){
      if(!material.rendering){
        if(renderingPreviews>=2)return res.status(429).json({error:'页面预览正在处理其他材料，请稍后重试'});
        renderingPreviews++;
        material.rendering=(async()=>{
          try{material.pdf=material.deck.sourceFormat==='pdf'?material.buffer:await convertOffice(material.buffer,'.'+material.deck.sourceFormat,'pdf:impress_pdf_Export:{"ExportHiddenSlides":{"type":"boolean","value":"true"}}');return material.pdf;}
          finally{renderingPreviews--;material.rendering=null;}
        })();
      }
      await material.rendering;
    }
    res.set('Cache-Control','no-store').type('application/pdf').send(material.pdf);
  }catch(error){next(error);}
});
app.post('/api/analyze-selection',(req,res,next)=>{
  try{
    pruneImports();const material=importedMaterials.get(req.body?.materialId);
    if(!material)return res.status(410).json({error:'材料预览已过期或服务已重启，请重新上传选页'});
    if(req.body.editedTexts){for(const [number,value]of Object.entries(req.body.editedTexts)){const page=material.deck.slides.find(p=>p.number===Number(number));if(page&&typeof value==='string'&&value.length<=50000){if(value!==page.text){material.deck.importWarnings=[...(material.deck.importWarnings||[]),'本次材料包含教师核对后的识别文字，请以原页复核公式和专业符号'];}page.text=value;page.paragraphs=value.split('\n').map(text=>({text,level:0}));}}}
    const deck=selectDeckPages(material.deck,req.body?.pageRange,{maxPages:maxSlideCount,maxCharacters:maxExtractedTextChars});
    if(!deck.slides.some(p=>(p.text||'').trim().length>5))return res.status(422).json({error:'所选材料没有正文，请先识别文字或填写核对后的文本'});
    deck.teachingTask = normalizeTask(req.body, req.body.analysisRequest, deck.sourceMode);
    startAnalysisJob(deck,String(req.body?.analysisRequest||'').trim(),res,`仅分析所选 ${deck.slideCount} 页，保留原文件页码`);
  }catch(error){if(!error.status)error.status=400;next(error);}
});
app.post("/api/analyze", upload.single("pptx"), async (req, res, next) => {
  if(parsingDocuments >= 2)return res.status(429).json({error:"已有材料正在解析，请稍后再提交。"});
  parsingDocuments++;
  try {
    if (!req.file) {
      return res.status(400).json({ error: "请选择一个 PPT、Word 或 PDF 文件" });
    }

    const rawName=req.file.originalname;
    const decodedName=Buffer.from(rawName,'latin1').toString('utf8');
    const filename=/[^\u0000-\u00ff]/.test(rawName)||decodedName.includes('\ufffd')?rawName:decodedName;
    const deck = await parseTeachingDocument(req.file.buffer, filename, {maxPages:maxSlideCount,maxCharacters:maxExtractedTextChars});
    if (deck.slideCount > maxSlideCount) {
      throw createInputLimitError(`课件共 ${deck.slideCount} 页，超过 ${maxSlideCount} 页分析上限`, "TOO_MANY_SLIDES");
    }
    const textCharacters = totalDeckTextLength(deck);
    if (textCharacters > maxExtractedTextChars) {
      throw createInputLimitError(`课件可提取正文约 ${textCharacters.toLocaleString()} 字，超过 ${maxExtractedTextChars.toLocaleString()} 字分析上限`, "TEXT_TOO_LARGE");
    }

    if(!deck.slides.some(p=>(p.text||'').trim().length>5))return res.status(422).json({error:'所选材料没有正文，请先识别文字或填写核对后的文本'});
    deck.teachingTask = normalizeTask(req.body, req.body.analysisRequest, deck.sourceMode);
    startAnalysisJob(deck, String(req.body.analysisRequest || "").trim(), res, "课件已上传，正在启动 AI 工作流");
  } catch (error) {
    next(error);
  } finally { parsingDocuments--; }
});

app.post("/api/analyze-text", (req, res, next) => {
  try {
    const content = String(req.body?.content || "").trim();
    if (content.length > 30000) throw createInputLimitError("文本输入超过 30,000 字上限", "TEXT_TOO_LARGE");
    const deck = textSourceToDeck({ title: req.body?.title, content, mode: req.body?.mode });
    if(!deck.slides.some(p=>(p.text||'').trim().length>5))return res.status(422).json({error:'所选材料没有正文，请先识别文字或填写核对后的文本'});
    deck.teachingTask = normalizeTask(req.body, req.body.analysisRequest, deck.sourceMode);
    startAnalysisJob(deck, String(req.body?.analysisRequest || "").trim(), res, "正在从文本材料创建备课单元");
  } catch (error) { next(error); }
});

function updateMotionRevision(job, phase, title, detail) {
  job.progress = { phase, title, detail, at: new Date().toISOString() };
  job.events.push(job.progress);
  if (job.events.length > 40) job.events.splice(0, job.events.length - 40);
  void motionRevisionJobStore.save(job).catch((error) => console.error(`保存动效修改任务 ${job.id} 失败`, error));
}

function motionRevisionError(error) {
  const status = Number(error?.status || 500);
  return {
    code: error?.code || "MOTION_REVISION_FAILED",
    message: error?.message || "动效修改失败",
    status,
    issues: Array.isArray(error?.issues) ? error.issues : [],
    requestId: error?.requestId || null,
    providerCode: error?.providerCode || null,
    attempt: error?.attempt || null,
    recovery: error?.code === "MOTION_QUALITY_FAILED"
      ? "当前版本已保留。可点击“按体检结果修改”补充约束后再试。"
      : status === 429
        ? "当前版本已保留。模型请求过于频繁，请稍后重试。"
        : "当前版本已保留，没有生成不完整的新版本。请根据上述原因调整要求后重试。",
  };
}

async function runMotionRevision(job, motion, instruction) {
  try {
    updateMotionRevision(job, "generating", "模型正在重新设计画面", `使用 ${job.model}，保留知识事实和观看问题。`);
    const value = await modelClient.forModel(job.model).completeJson({
      stage: "修改单段教学动效", system: "你是教学信息设计师。保留知识事实，按教师修改要求重做 SVG；只输出 JSON。",
      prompt: `原知识点：${JSON.stringify({ title: motion.title, narration: motion.narration, teachingQuestion: motion.teachingQuestion, bindings: motion.scene.bindings, phases: motion.scene.phases, teachingCheck: motion.scene.teachingCheck })}\n教师修改要求：${instruction}\n原 SVG：${motion.scene.svgMarkup}\n\n输出完整 JSON：{"title":"","teachingQuestion":"","visualMetaphor":"","representationStrategy":"为什么新呈现方式最适合这个机制","designRationale":"说明条件、触发、中间机制、结果与反证如何被画面证明","teachingCheck":"学生只看画面就能回答的问题","durationMs":9000,"phases":[{"label":"","at":0}],"bindings":[{"svgId":"","claim":"","role":"条件|触发|中间机制|结果|反证"}],"svgMarkup":"<svg ...>...</svg>"}。\n强制要求：保留课件事实和教学问题；至少 4 个解释阶段、4 项可见事实绑定、3 个 data-phase-index 和 2 处有意义的动态变化；不得从初始直接跳到结果，必须显示决定结果的中间机制；必须用对照、反例或失败路径纠正误解；优先用真实对象、状态变形、局部放大、同步轨迹或空间演算，禁止默认使用彩色方框加长箭头；只有不可替代的关系才画连接线，且每条线带 data-connector、位于节点之后、端点停在边界外 12–20px，不得进入节点、压住文字或横穿对象；文字与背景保持高对比度；不允许只淡入、闪烁、变色或堆叠文字；禁止脚本、外链和虚构事实。`,
    });
    updateMotionRevision(job, "quality", "正在检查教学可读性", "检查中间机制、阶段、动态意义、文字密度和连接线。");
    const draft = createMotionDraft(value, { title: motion.title, teachingQuestion: motion.teachingQuestion, evidence: motion.scene.evidence || [] }, job.model, 1);
    job.drafts = [draft];
    await motionRevisionJobStore.save(job);
    const scene = draft.scene;
    if (!scene) { const error = new Error('修改输出不符合安全或结构要求，已在任务中隔离保存；原版未改动。'); error.code = 'MOTION_SCENE_INVALID'; error.status = 422; throw error; }
    job.state = "completed";
    job.result = { motion: { ...motion, title: scene.title, scene, runtimeCheck: null, qualityReview: null, generationQuality: draft.quality, generationDrafts: [publicMotionDraft(draft)], selectedDraftId: draft.id } };
    updateMotionRevision(job, "complete", "修改草稿已生成", "草稿已保留，请试播并核对原理后确认课堂可用。");
  } catch (error) {
    job.state = "failed";
    job.error = motionRevisionError(error);
    updateMotionRevision(job, "failed", "动效修改未完成", job.error.message);
  }
}

app.post("/api/revise-motion", (req, res) => {
  const motion = req.body?.motion; const instruction = String(req.body?.instruction || "").trim();
  if (!motion?.scene || !instruction) return res.status(400).json({ code: "INVALID_MOTION_REVISION", error: "请提供要修改的动效及明确的修改要求。" });
  if (!modelClient.configured) return res.status(503).json({ code: "MODEL_NOT_CONFIGURED", error: "当前未配置可用的模型。" });
  const id = randomUUID();
  const model = process.env.LLM_RENDER_MODEL || process.env.LLM_VISUAL_MODEL || modelClient.model;
  const job = { id, state: "running", model, runtime: modelClient.runtime, createdAt: new Date().toISOString(), events: [] };
  updateMotionRevision(job, "queued", "修改任务已提交", `即将使用 ${model} 重新设计这一版。`);
  motionRevisionJobs.set(id, job);
  res.status(202).json({ jobId: id, model, runtime: job.runtime, progress: job.progress });
  void runMotionRevision(job, motion, instruction);
});

app.get("/api/revise-motion/:jobId", (req, res) => {
  const job = motionRevisionJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ code: "MOTION_REVISION_JOB_NOT_FOUND", error: "动效修改任务已过期，当前版本没有变化。" });
  const payload = { state: job.state, model: job.model, runtime: job.runtime, progress: job.progress, events: job.events };
  if (job.state === "completed") return res.json({ ...payload, result: job.result });
  if (job.state === "failed") return res.status(job.error.status).json({ ...payload, ...job.error, error: job.error.message, partialResult: job.partialResult || null });
  res.json(payload);
});

app.post('/api/teaching-task', (req, res) => {
  const input = req.body;
  if (!['plan', 'render', 'knowledge', 'question', 'resource'].includes(input?.kind) || !input?.target || typeof input.target !== 'object' || !Array.isArray(input.source) || input.source.length > 40) return res.status(400).json({ error: '任务或材料格式不正确' });
  if (input.kind === 'render' && (!input.blueprint || input.approved !== true)) return res.status(400).json({ error: '请先确认讲解方案' });
  if (!modelClient.configured) return res.status(503).json({ error: '当前未配置可用模型' });
  const model = input.kind === 'render' ? process.env.LLM_RENDER_MODEL : input.kind === 'plan' ? process.env.LLM_VISUAL_PLANNER_MODEL : process.env.LLM_REASONING_MODEL;
  const job = { id: randomUUID(), state: 'running', model: model || modelClient.model, runtime: modelClient.runtime, createdAt: new Date().toISOString(), events: [] };
  motionRevisionJobs.set(job.id, job);
  updateMotionRevision(job, 'queued', '任务已提交', job.model);
  res.status(202).json({ jobId: job.id, model: job.model, runtime: job.runtime });
  void runTeachingTask(input, modelClient, async p => {
    if (p.motionDraft) {
      job.drafts = [...(job.drafts || []), p.motionDraft];
      const d = p.motionDraft;
      if (d.scene) job.partialResult = { value: { knowledgePointId: input.target.id, title: input.target.title, scene: d.scene, blueprint: input.blueprint, teachingQuestion: input.target.question || input.target.teachingQuestion, narration: input.target.logic || input.target.coreLogic, generationQuality: d.quality, selectedDraftId: d.id, generationDrafts: job.drafts.map(publicMotionDraft) } };
      await motionRevisionJobStore.save(job);
    }
    updateMotionRevision(job, p.phase || 'generating', p.title, p.detail);
  }).then(result => {
    job.state = 'completed'; job.result = { value: result };
    updateMotionRevision(job, 'complete', '结果已生成', '等待查看和应用');
  }).catch(error => { job.state = 'failed'; job.error = motionRevisionError(error); updateMotionRevision(job, 'failed', '任务未完成', job.error.message); });
});

app.get("/api/analyze/:jobId", (req, res) => {
  const job = analysisJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ code: "ANALYSIS_JOB_NOT_FOUND", error: "分析任务已过期，请重新提交课件" });
  if (job.state === "completed") return res.json({ state: job.state, progress: job.progress, events: job.events, result: job.result, model: job.model, runtime: job.runtime });
  if (job.state === "failed") return res.status(job.error.status).json({ state: job.state, progress: job.progress, events: job.events, ...job.error, partialResult: job.partialResult || null, model: job.model, runtime: job.runtime });
  res.json({ state: job.state, progress: job.progress, events: job.events, partialResult: job.partialResult || null, model: job.model, runtime: job.runtime });
});

app.post('/api/analyze/:jobId/cancel',(req,res)=>{
  const job=analysisJobs.get(req.params.jobId);
  if(!job)return res.status(404).json({error:'任务不存在'});
  if(job.state==='running'){job.cancelled=true;job.state='failed';job.error={code:'CANCELLED',status:409,message:'已停止后续生成；已完成内容保留'};recordJobProgress(job,{at:new Date().toISOString(),phase:'failed',title:'教师停止了生成',detail:'已发出的请求可能仍产生费用，不再发起后续步骤'});}
  res.json({ok:true});
});

app.use((error, _req, res, _next) => {
  console.error(error);
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({
      code: "FILE_TOO_LARGE",
      error: `PPTX 超过 ${maxPptxSizeMb} MB 上限，请压缩后重试`,
      recovery: "请删除或压缩课件中的视频、音频和高分辨率图片，再重新上传。",
    });
  }
  if (error?.code === "MODEL_NOT_CONFIGURED") {
    return res.status(503).json({
      code: error.code,
      error: error.message,
      recovery: "请先在扣子项目的环境变量中配置 LLM_BASE_URL、LLM_API_KEY 和 LLM_MODEL，再重新部署。",
    });
  }
  if (["TOO_MANY_SLIDES", "TEXT_TOO_LARGE"].includes(error?.code)) {
    return res.status(413).json({ code: error.code, error: error.message, recovery: "请按章节拆分课件或删除与本次备课无关的附录、讲稿与重复页面后重试。" });
  }
  const status = error instanceof multer.MulterError ? 400 : Number(error?.status || 500);
  res.status(status).json({
    code: error?.code || "ANALYSIS_FAILED",
    error: error?.message || "分析失败，请检查 PPTX 文件",
    recovery: status === 429
      ? "模型请求过于频繁，请稍后重试。"
      : status >= 500
        ? "课件仍保留在页面中；请检查模型服务状态后重试，系统不会改用模板结果。"
        : undefined,
  });
});

app.listen(port, process.env.HOST || "127.0.0.1", () => {
  console.log(`PPT 知识动效 Demo 已启动: http://localhost:${port}`);
});
import { normalizeTask } from './src/lesson-constraints.mjs';
import {loadSettings,installSettings} from './src/model-settings.mjs';
function cancellableClient(client,job){return {...client,forModel:model=>cancellableClient(client.forModel(model),job),async completeJson(args){if(job.cancelled)throw Error('任务已停止');const result=await client.completeJson(args);if(job.cancelled)throw Error('任务已停止');return result;}};}
import {recognizePages} from './src/local-ocr.mjs';
