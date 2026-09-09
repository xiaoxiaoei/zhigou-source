function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function text(value, fallback = "待完善") {
  const result = String(value || "").trim();
  return escapeHtml(result || fallback);
}

function list(items = [], ordered = false) {
  const values = (Array.isArray(items) ? items : []).map(item => String(item || "").trim()).filter(Boolean);
  if (!values.length) return '<p class="empty">待完善</p>';
  const tag = ordered ? "ol" : "ul";
  return `<${tag}>${values.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</${tag}>`;
}

function evidenceMarkup(point = {}, unit = {}) {
  const materials = new Map(listUnitMaterials(unit).map(material => [material.id, material]));
  const evidence = Array.isArray(point.evidence) ? point.evidence.filter(item => evidenceIsActive(unit, item)) : [];
  if (!evidence.length) return '<p class="evidence missing">未关联原文证据，请教师复核。</p>';
  return `<div class="evidence"><b>材料依据</b>${evidence.map(item => {const material=materials.get(item.materialId||"primary");return `<blockquote><span>${text(material?.title,"主材料")} · 第 ${Number(item.slideNumber) || "?"} 页</span>${text(item.quote, "")}</blockquote>`}).join("")}</div>`;
}

function knowledgeMarkup(points = [], unit = {}) {
  if (!points.length) return '<p class="empty">尚未形成知识分析。</p>';
  return points.map((point, index) => `<article class="knowledge"><span>${String(index + 1).padStart(2, "0")}</span><div><h3>${text(point.title)}</h3><p>${text(point.logic || point.coreLogic || point.explanation)}</p><dl><div><dt>常见误解</dt><dd>${text(point.misconception, "待课堂验证")}</dd></div><div><dt>诊断提问</dt><dd>${text(point.question || point.teachingQuestion, "待补充")}</dd></div></dl>${evidenceMarkup(point,unit)}</div></article>`).join("");
}

function materialsMarkup(unit = {}) {
  const materials = listUnitMaterials(unit);
  return `<ul>${materials.map(material => `<li><b>${text(materialRoleLabel(material.role))}：</b>${text(material.title)}${material.archivedAt ? "（已归档）" : ""}</li>`).join("")}</ul>`;
}

function flowMarkup(flow = []) {
  if (!flow.length) return '<p class="empty">尚未形成课堂流程。</p>';
  return `<table><thead><tr><th>环节</th><th>教师活动</th><th>学生活动</th><th>可观察产出</th><th>形成性反馈</th><th>时间</th></tr></thead><tbody>${flow.map(item => `<tr><td><b>${text(item.phase)}</b></td><td>${text(item.teacherAction)}</td><td>${text(item.studentAction)}</td><td>${text(item.studentOutput, "待补充")}</td><td>${text(item.feedback, "待补充")}</td><td>${Number(item.minutes) || text(item.minutes, "—")} min</td></tr>`).join("")}</tbody></table>`;
}

function rubricMarkup(items = []) {
  if (!items.length) return "";
  const total = items.reduce((sum, item) => sum + (Number(item?.points) || 0), 0);
  return `<div class="resource-extra"><b>评分量规（共 ${total} 分）</b><table><thead><tr><th>评价维度</th><th>达标标准</th><th>分值</th></tr></thead><tbody>${items.map(item => `<tr><td>${text(item.criterion)}</td><td>${text(item.standard)}</td><td>${Number(item.points) || 0}</td></tr>`).join("")}</tbody></table></div>`;
}

function resourceDetails(resource = {}) {
  const details = resource.details || {};
  if (resource.type === "code") return `${details.language ? `<p><b>语言 / 环境：</b>${text(details.language)}</p>` : ""}${details.code ? `<pre><code>${escapeHtml(details.code)}</code></pre>` : ""}${details.sampleInput ? `<p><b>初始条件：</b>${text(details.sampleInput)}</p>` : ""}${details.walkthrough ? `<p><b>观察重点：</b>${text(details.walkthrough)}</p>` : ""}${Array.isArray(details.traceSteps) && details.traceSteps.length ? `<div class="resource-extra"><b>引导式代码追踪（不执行代码）</b><ol>${details.traceSteps.map(frame => `<li><span>第 ${Number(frame.line) || "?"} 行 · ${text(frame.state, "状态待补充")}</span>${text(frame.explanation, "")}</li>`).join("")}</ol></div>` : ""}`;
  if (resource.type === "lab") return `${details.objective ? `<p><b>实验目标：</b>${text(details.objective)}</p>` : ""}${details.estimatedMinutes ? `<p><b>预计用时：</b>${Number(details.estimatedMinutes)} 分钟</p>` : ""}${details.prerequisites ? `<p><b>前置条件：</b>${text(details.prerequisites)}</p>` : ""}${Array.isArray(details.steps) && details.steps.length ? `<div class="resource-extra"><b>实验步骤</b>${list(details.steps, true)}</div>` : ""}${details.deliverables ? `<p><b>提交物与验收证据：</b>${text(details.deliverables)}</p>` : ""}${rubricMarkup(details.rubric)}`;
  if (resource.type === "case") return `${details.context ? `<p><b>案例背景：</b>${text(details.context)}</p>` : ""}${details.scenario ? `<p><b>案例情境：</b>${text(details.scenario)}</p>` : ""}${Array.isArray(details.questions) && details.questions.length ? `<div class="resource-extra"><b>讨论问题</b>${list(details.questions, true)}</div>` : ""}${details.teachingNotes ? `<p><b>教师引导：</b>${text(details.teachingNotes)}</p>` : ""}`;
  return "";
}

function resourcesMarkup(resources = [], keyPoints = []) {
  if (!resources.length) return '<p class="empty">尚未建立教学资源。</p>';
  const typeNames = { motion: "动态解释", code: "代码演示", lab: "实验任务", case: "教学案例" };
  const labels = new Map((keyPoints || []).map(point => [String(point.id || ""), point.title]));
  return resources.map((resource, index) => { const linked = (resource.keyPointIds || []).map(id => labels.get(String(id))).filter(Boolean); return `<article class="resource"><header><span>${text(typeNames[resource.type] || "教学资源")}</span><small>${text(resource.status, "草稿")}</small></header><h3>${text(resource.title, `教学资源 ${index + 1}`)}</h3><p>${text(resource.purpose)}</p>${["code","lab","case"].includes(resource.type) ? `<p><b>服务知识点：</b>${linked.length ? text(linked.join("、")) : "未关联"}</p>` : ""}${resourceDetails(resource)}</article>`; }).join("");
}

function classroomTimelineMarkup(unit = {}) {
  const report = buildClassroomTimeline(unit);
  if (!report.rows.length) return '<p class="empty">尚未形成课堂时间轴。</p>';
  const typeNames = { motion: "动态解释", code: "代码演示", lab: "实验任务", case: "教学案例", question: "诊断题" };
  return `<table><thead><tr><th>时间</th><th>课堂环节</th><th>安排的教学内容</th></tr></thead><tbody>${report.rows.map(row => `<tr><td><b>${row.start}–${row.end} min</b></td><td>${text(row.activity.phase)}</td><td>${row.items.length ? row.items.map(item => `${text(typeNames[item.type] || "教学内容")}：${text(item.title)}`).join("<br>") : "暂无安排"}</td></tr>`).join("")}</tbody></table>${report.unassigned.length ? `<p><b>待安排内容：</b>${report.unassigned.map(item => text(item.title)).join("、")}</p>` : ""}`;
}

function questionsMarkup(questions = []) {
  if (!questions.length) return '<p class="empty">尚未建立诊断题。</p>';
  return questions.map((question, index) => { const quality=assessDiagnosticQuestion(question,index);return `<article class="question"><span>诊断 ${String(index + 1).padStart(2, "0")} · ${text(quality.levelLabel)}</span><h3>${text(question.prompt || question.question)}</h3><p><b>判定依据：</b>${text(question.answerCue || question.purpose)}</p><p><b>错误信号：</b>${text(question.misconception, "待课堂观察")}</p></article>`}).join("");
}

function diagnosticRunsMarkup(runs = []) {
  const latest = (Array.isArray(runs) ? runs : []).filter(run => run?.status === "completed").slice(-3).reverse();
  if (!latest.length) return "";
  return `<div class="resource-extra"><b>最近课堂诊断记录</b>${latest.map(run => {const observations=Array.isArray(run.observations)?run.observations:[],understood=observations.filter(item=>item.result==="understood").length,confused=observations.filter(item=>item.result==="confused").length,incomplete=observations.length-understood-confused;return `<article class="question"><span>${text(run.completedAt?new Date(run.completedAt).toLocaleString("zh-CN",{hour12:false}):"课堂记录")}</span><h3>${observations.length} 题 · ${understood} 题多数理解 · ${confused} 题出现误解 · ${incomplete} 题未完成</h3>${observations.filter(item=>item.result==="confused"||item.result==="incomplete").map(item=>`<p><b>${item.result==="confused"?"误解":"未完成"}：</b>${text(item.prompt)}${item.note?`<br>课堂观察：${text(item.note)}`:""}</p>`).join("")}</article>`}).join("")}</div>`;
}

function diagnosticSetMarkup(unit = {}) {
  const report = assessDiagnosticQuality(unit); if (!report.total) return "";
  const levelNames = { recall: "回忆", understand: "理解", apply: "应用", transfer: "迁移", unclear: "层次待明确" };
  return `<div class="resource-extra"><b>诊断题组覆盖</b><table><tbody><tr><th>知识覆盖</th><td>${report.coverageCount}/${report.coverageTotal} 个核心与一般知识点${report.uncoveredKnowledge.length ? `；未覆盖：${text(report.uncoveredKnowledge.map(row => row.label).join("、"))}` : ""}</td></tr><tr><th>认知层次</th><td>${text(report.levelsUsed.map(level => levelNames[level]).join("、") || "待明确")}</td></tr><tr><th>重复检查</th><td>${report.duplicatePairs.length ? text(report.duplicatePairs.map(pair => `${pair.leftLabel}与${pair.rightLabel}：${pair.reason}`).join("；")) : "未发现高度重复题"}</td></tr></tbody></table></div>`;
}

function improvementMarkup(items = []) {
  const actions = (Array.isArray(items) ? items : []).filter(item => item?.text);
  if (!actions.length) return '<p class="empty">尚未从课后复盘形成下一版调整。</p>';
  return `<div class="questions">${actions.map(item => `<article class="question"><span>${item.status === "done" ? "已落实" : "待调整"}</span><h3>${text(item.text)}</h3>${item.evidence ? `<p><b>课堂证据：</b>${text(item.evidence)}</p>` : ""}${item.issue ? `<p><b>问题判断：</b>${text(item.issue)}</p>` : ""}</article>`).join("")}</div>`;
}

function alignmentMarkup(unit = {}) {
  const report = buildTeachingAlignment(unit);
  if (!report.total) return '<p class="empty">尚未建立可检查的学习目标。</p>';
  const labels = (refs, items) => refs.map(ref => items.find(item => item.ref === ref)?.label).filter(Boolean).join("、") || "未关联";
  return `<table><thead><tr><th>学习目标</th><th>知识与材料依据</th><th>课堂活动</th><th>诊断问题</th><th>状态</th></tr></thead><tbody>${report.rows.map(row => `<tr><td><b>${text(row.objective)}</b><br><small>${row.confirmed ? "教师已确认" : "系统建议待确认"}</small></td><td>${text(labels(row.knowledgeRefs, report.entities.knowledge))}${row.knowledgeRefs.length && !row.supportedKnowledge ? "<br><small>原文证据待核对</small>" : ""}</td><td>${text(labels(row.activityRefs, report.entities.activities))}</td><td>${text(labels(row.questionRefs, report.entities.questions))}</td><td>${row.complete ? "链路完整" : text(row.gaps.join("；"))}</td></tr>`).join("")}</tbody></table>`;
}

function activityAlignmentMarkup(unit = {}) {
  const report = buildTeachingAlignment(unit);
  if (!report.activityTotal) return '<p class="empty">尚未建立课堂活动。</p>';
  const labels = (values = []) => values.length ? values.join("、") : "未关联";
  const questionLabels = refs => refs.map(ref => report.entities.questions.find(item => item.ref === ref)?.label).filter(Boolean);
  return `<h3>课堂活动反向证据链</h3><table><thead><tr><th>课堂活动</th><th>服务目标</th><th>学生可观察产出</th><th>教师形成性反馈</th><th>诊断验证</th><th>状态</th></tr></thead><tbody>${report.activityRows.map(row => `<tr><td><b>${text(row.label)}</b></td><td>${text(labels(row.objectiveLabels))}</td><td>${text(row.studentOutput)}</td><td>${text(row.feedback)}</td><td>${text(labels(questionLabels(row.questionRefs)))}</td><td>${row.structuralComplete ? row.confirmed ? "教师已确认" : "系统建议待确认" : text(row.gaps.join("；"))}</td></tr>`).join("")}</tbody></table>`;
}

export function buildTeachingPackageHtml(unit = {}) {
  const lesson = unit.lesson || {};
  const source = unit.source || {};
  const generatedAt = new Intl.DateTimeFormat("zh-CN", { dateStyle: "long", timeStyle: "short" }).format(new Date());
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${text(unit.title, "教学单元")} · 课堂包</title><style>
  :root{--ink:#22352f;--muted:#6d7b75;--line:#dfe4df;--paper:#fff;--soft:#f4f5f1;--accent:#507d6d;--warm:#a36f54}*{box-sizing:border-box}body{margin:0;background:#edece7;color:var(--ink);font:15px/1.7 system-ui,"PingFang SC","Microsoft YaHei",sans-serif}.page{width:min(1080px,calc(100% - 32px));margin:28px auto;padding:54px 62px;background:var(--paper);box-shadow:0 12px 40px #24382f1f}.cover{padding-bottom:34px;border-bottom:2px solid var(--ink)}.eyebrow,.section-label{color:var(--warm);font-size:11px;font-weight:800;letter-spacing:.15em}.cover h1{max-width:800px;margin:12px 0 14px;font:600 38px/1.25 Georgia,"Songti SC",serif}.meta{display:flex;flex-wrap:wrap;gap:8px 22px;color:var(--muted)}.summary{margin:28px 0;padding:20px 24px;border-left:5px solid var(--accent);background:var(--soft);font-size:17px}.section{padding:32px 0;border-bottom:1px solid var(--line)}.section>h2{margin:6px 0 20px;font:600 25px Georgia,"Songti SC",serif}.two{display:grid;grid-template-columns:1fr 1fr;gap:24px}.card,.resource,.question{padding:20px;border:1px solid var(--line);border-radius:12px;break-inside:avoid}.card h3,.resource h3,.question h3{margin:5px 0 10px}.knowledge{display:grid;grid-template-columns:48px 1fr;gap:14px;padding:20px 0;border-top:1px solid var(--line);break-inside:avoid}.knowledge>span,.question>span,.resource header span{color:var(--warm);font-size:11px;font-weight:800;letter-spacing:.09em}.knowledge h3{margin:0 0 5px;font-size:19px}.knowledge dl{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0}.knowledge dl div{padding:12px;background:var(--soft)}dt{font-size:12px;font-weight:800}dd{margin:2px 0 0}.evidence{margin-top:12px;padding:12px 14px;background:#f8f3ef}.evidence b{font-size:12px}.evidence blockquote{margin:8px 0 0;padding-left:12px;border-left:2px solid #d5b6a5}.evidence blockquote span{display:block;color:var(--warm);font-size:11px}.evidence.missing{color:#965943}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:11px 10px;border:1px solid var(--line);text-align:left;vertical-align:top}th{background:var(--soft)}.resources,.questions{display:grid;grid-template-columns:1fr 1fr;gap:14px}.resource header{display:flex;justify-content:space-between}.resource header small{color:var(--muted)}.resource-extra{margin-top:15px;padding-top:13px;border-top:1px dashed var(--line)}pre{overflow:auto;padding:14px;border-radius:8px;background:#17251f;color:#dcebe4;font:12px/1.7 ui-monospace,monospace}.empty{color:var(--muted);font-style:italic}.footer{padding-top:28px;color:var(--muted);font-size:12px}.footer b{color:var(--ink)}@page{size:A4;margin:16mm}@media print{body{background:#fff}.page{width:auto;margin:0;padding:0;box-shadow:none}.section{break-inside:auto}.resources,.questions{display:block}.resource,.question{margin-bottom:12px}}@media(max-width:760px){.page{padding:30px 22px}.two,.resources,.questions,.knowledge dl{grid-template-columns:1fr}.cover h1{font-size:30px}}
  </style></head><body><main class="page"><header class="cover"><span class="eyebrow">知构 · 大学教师 AI 备课工作台</span><h1>${text(unit.title, "教学单元")}</h1><div class="meta"><span>${text(unit.course, "未归入课程")}</span><span>${text(unit.chapter, "教学单元")}</span><span>${text(unit.duration, "90 分钟")}</span><span>${text(unit.status, "草稿")}</span></div></header><div class="summary">${text(unit.overview, "尚未填写本节课的核心问题。")}</div><section class="section"><span class="section-label">LEARNING OUTCOMES</span><h2>学习目标</h2>${list(unit.objectives, true)}</section><section class="section"><span class="section-label">CONSTRUCTIVE ALIGNMENT</span><h2>目标—知识—活动—评价对齐</h2>${alignmentMarkup(unit)}${activityAlignmentMarkup(unit)}</section><section class="section"><span class="section-label">KNOWLEDGE & EVIDENCE</span><h2>知识重点、难点与材料依据</h2>${knowledgeMarkup(unit.keyPoints || [],unit)}</section><section class="section"><span class="section-label">CLASSROOM TIMELINE</span><h2>课堂时间轴</h2>${classroomTimelineMarkup(unit)}</section><section class="section"><span class="section-label">LESSON FLOW</span><h2>课堂实施流程</h2>${flowMarkup(lesson.flow || [])}</section><section class="section"><span class="section-label">TEACHING ASSETS</span><h2>教学资源</h2>${motionExports(unit)}<div class="resources">${resourcesMarkup(unit.resources || [], unit.keyPoints || [])}</div></section><section class="section"><span class="section-label">ASSESSMENT</span><h2>课堂诊断与课后证据</h2><div class="questions">${questionsMarkup(lesson.questions || [])}</div>${diagnosticSetMarkup(unit)}${diagnosticRunsMarkup(lesson.diagnosticRuns)}<div class="card" style="margin-top:14px"><h3>课后证据与下次调整</h3>${list(lesson.afterClass || [], true)}</div></section><section class="section"><span class="section-label">NEXT ITERATION</span><h2>下一版备课调整</h2>${improvementMarkup(unit.improvementActions)}</section><footer class="footer"><p><b>本单元材料：</b></p>${materialsMarkup(unit)}<p>导出于 ${escapeHtml(generatedAt)}。请在授课前核对知识表述、原文证据和资源状态。</p></footer></main></body></html>`;
}
import { evidenceIsActive, listUnitMaterials, materialRoleLabel } from "./material-library.js";
import { buildTeachingAlignment } from "./teaching-alignment.js";
import { assessDiagnosticQuality, assessDiagnosticQuestion } from "./diagnostic-quality.js";
import { buildClassroomTimeline } from "./classroom-timeline.js";
import {safeSvg} from './safe-svg.js';
function motionExports(unit){return (unit.animations||[]).map(m=>{
  const version=m.versions?.find(v=>v.versionNumber===m.currentVersion)||m.versions?.at(-1)||m;
  const scene=version.scene||{},svg=safeSvg(scene.svgMarkup);if(!svg)return '';
  const data=JSON.stringify({duration:scene.totalDurationMs||9000,phases:scene.phases||[]}).replace(/</g,'\\u003c');
  const html=`<!doctype html><meta charset="utf-8"><style>body{margin:0;font:14px sans-serif}svg{width:100%;height:auto;max-height:430px}input{width:70%}button{padding:8px}</style>${svg}<button id="play">播放/暂停</button><input id="seek" type="range" min="0" max="1000" value="0" aria-label="播放进度"><script>const cfg=${data};const svg=document.querySelector('svg'),seek=document.getElementById('seek');let playing=false,last=0;function draw(){const t=Number(seek.value)/1000;let active=0;cfg.phases.forEach((p,i)=>{if(t>=p.at)active=i});svg.querySelectorAll('[data-phase-index],.phase-group').forEach(e=>{const i=Number(e.dataset.phaseIndex??e.dataset.phase??e.className.baseVal.match(/phase(\\d+)/)?.[1]);if(!Number.isFinite(i))return;e.classList.toggle('active',i===active);if(e.classList.contains('phase-group')||e.dataset.phaseMode==='exclusive')e.style.setProperty('display',i===active?'inline':'none','important');});svg.pauseAnimations?.();svg.setCurrentTime?.(t*cfg.duration/1000);for(const a of svg.getAnimations?.({subtree:true})||[]){a.pause();a.currentTime=t*cfg.duration}}seek.oninput=()=>{playing=false;draw()};document.getElementById('play').onclick=()=>{if(Number(seek.value)>=1000)seek.value=0;playing=!playing;last=0};function tick(now){if(playing){if(last)seek.value=Math.min(1000,Number(seek.value)+(now-last)/cfg.duration*1000);draw();if(Number(seek.value)>=1000)playing=false}last=now;requestAnimationFrame(tick)}draw();requestAnimationFrame(tick);</script>`;
  return `<article><h3>${text(m.title)} · 第${version.versionNumber||1}版</h3><iframe title="${text(m.title)}" sandbox="allow-scripts" style="width:100%;height:510px;border:1px solid #ddd" srcdoc="${escapeHtml(html)}"></iframe><p>${text(version.narration||version.explanation||scene.designRationale||'')}</p><p>生成内容须经教师核对后用于课堂。</p></article>`;
}).join('');}
