import { buildScene, compactLabel } from "./scene-builder.mjs";
import { createLlmClientFromEnv } from "./llm-client.mjs";
import { runSemanticWorkflow } from "./semantic-workflow.mjs";

const cueWeights = new Map([
  ["定义", 4], ["原理", 4], ["核心", 4], ["关键", 4], ["重点", 4],
  ["条件", 3], ["算法", 3], ["步骤", 3], ["流程", 3], ["方法", 3],
  ["特点", 2], ["特征", 2], ["类型", 2], ["分类", 2], ["组成", 2],
  ["原因", 2], ["结果", 2], ["影响", 2], ["对比", 2], ["区别", 2],
]);

const noisePatterns = [
  /^\d+$/,
  /^(thank you|谢谢|目录|教学内容|教学重点|教学难点|contents?)$/i,
  /copyright|all rights reserved|http[s]?:\/\//i,
];

function normalizeLine(value = "") {
  return value
    .replace(/^[\s•·▪▫◆◇●○▸▹①-⑳\-]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function canonical(value = "") {
  return normalizeLine(value).replace(/[\s，。；：、,.!?！？“”"'()（）]/g, "").toLowerCase();
}

function isUsefulLine(line) {
  if (!line || line.length < 4 || line.length > 220) return false;
  if (noisePatterns.some((pattern) => pattern.test(line))) return false;
  return /[\p{L}\p{N}]/u.test(line);
}

function conciseSentence(value = "", maxLength = 54) {
  const text = normalizeLine(value);
  const first = text.split(/[。；;！？!?]/)[0].trim();
  const chosen = first.length >= 4 ? first : text;
  return chosen.length <= maxLength ? chosen : `${chosen.slice(0, maxLength - 1)}…`;
}

function lineScore(line, { isTitle = false, bullet = false, slideNumber = 1 } = {}) {
  let score = isTitle ? 5 : 0;
  if (bullet) score += 1;
  if (line.length >= 10 && line.length <= 90) score += 2;
  if (/[：:]|[—-]{2,}/.test(line)) score += 1;
  if (/[0-9一二三四五六七八九十]\s*[.、）)]/.test(line)) score += 1;
  if (/\S是\S|是指|由.+组成|包括|分为|需要满足/.test(line)) score += 2;
  for (const [cue, weight] of cueWeights) {
    if (line.includes(cue)) score += weight;
  }
  if (slideNumber <= 2) score += 0.5;
  return score;
}

function collectCandidates(deck) {
  const candidates = [];
  for (const slide of deck.slides) {
    if (isUsefulLine(slide.title)) {
      candidates.push({
        text: normalizeLine(slide.title),
        score: lineScore(slide.title, { isTitle: true, slideNumber: slide.number }),
        slideNumber: slide.number,
        source: "title",
      });
    }
    for (const paragraph of slide.paragraphs) {
      const text = normalizeLine(paragraph.text);
      if (!isUsefulLine(text)) continue;
      candidates.push({
        text,
        score: lineScore(text, { bullet: paragraph.bullet, slideNumber: slide.number }),
        slideNumber: slide.number,
        source: "body",
      });
    }
    for (const row of slide.tableRows || []) {
      const text = normalizeLine(row.join("；"));
      if (!isUsefulLine(text)) continue;
      candidates.push({
        text,
        score: lineScore(text, { slideNumber: slide.number }) + 1,
        slideNumber: slide.number,
        source: "table",
      });
    }
  }
  return candidates;
}

function buildKeyPoints(deck) {
  const allCandidates = collectCandidates(deck);
  const grouped = new Map();
  for (const item of allCandidates) {
    const key = canonical(item.text);
    if (key.length < 3) continue;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...item, slideNumbers: [item.slideNumber], frequency: 1 });
    } else {
      existing.frequency += 1;
      existing.score += 1.5;
      if (!existing.slideNumbers.includes(item.slideNumber)) existing.slideNumbers.push(item.slideNumber);
    }
  }

  const sorted = [...grouped.values()]
    .sort((a, b) => b.score - a.score || a.slideNumber - b.slideNumber);

  const selected = [];
  let titleCount = 0;
  for (const item of sorted) {
    if (item.source === "title" && titleCount >= 6) continue;
    const itemKey = canonical(item.text);
    const overlaps = selected.some((chosen) => {
      const chosenKey = canonical(chosen.text);
      return itemKey.length > 7 && chosenKey.length > 7 && (itemKey.includes(chosenKey) || chosenKey.includes(itemKey));
    });
    if (overlaps) continue;
    selected.push(item);
    if (item.source === "title") titleCount += 1;
    if (selected.length >= 12) break;
  }

  return selected.map((item, index) => {
    const supporting = item.source === "title"
      ? allCandidates
        .filter((candidate) => candidate.source !== "title" && item.slideNumbers.includes(candidate.slideNumber))
        .filter((candidate) => canonical(candidate.text) !== canonical(item.text))
        .sort((a, b) => b.score - a.score || b.text.length - a.text.length)[0]
      : null;
    return {
      id: `kp-${index + 1}`,
      title: conciseSentence(item.text, 30),
      visualLabel: compactLabel(item.text, 8),
      explanation: conciseSentence(supporting?.text || item.text, 54),
      slideNumbers: item.slideNumbers,
      importance: item.score >= 8 ? "high" : item.score >= 5 ? "medium" : "supporting",
      evidenceType: item.source,
    };
  });
}

function slideItems(slide, limit = 6) {
  const seen = new Set();
  return slide.paragraphs
    .map((paragraph) => normalizeLine(paragraph.text))
    .filter(isUsefulLine)
    .filter((text) => {
      const key = canonical(text);
      if (seen.has(key) || key === canonical(slide.title)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

function mergeRepeatedTitleSlides(slides) {
  const groups = [];
  for (const slide of slides) {
    const previous = groups.at(-1);
    if (previous && canonical(previous.title) === canonical(slide.title)) {
      previous.slideNumbers.push(slide.number);
      previous.paragraphs.push(...slide.paragraphs);
      previous.tableRows.push(...(slide.tableRows || []));
      for (const [key, value] of Object.entries(slide.media || {})) {
        previous.media[key] = (previous.media[key] || 0) + value;
      }
      continue;
    }
    groups.push({
      ...slide,
      slideNumbers: [slide.number],
      paragraphs: [...slide.paragraphs],
      tableRows: [...(slide.tableRows || [])],
      media: { ...(slide.media || {}) },
    });
  }
  return groups;
}

function detectAnimationType(slide, items) {
  const title = slide.title || "";
  const text = `${slide.title}\n${items.join("\n")}`;
  const cycleTitle = title.replace(/无循环|不存在循环|非循环|禁止循环|避免循环/g, "");
  const cycleText = text.replace(/无循环|不存在循环|非循环|禁止循环|避免循环/g, "");
  const numericCount = (text.match(/-?\d+(?:\.\d+)?/g) || []).length;
  if (numericCount >= 3 && /轨迹|位置|距离|坐标|移动|变化曲线|调度顺序|访问顺序/.test(text)) return "trajectory";
  if (/(?:请求|持有|占用|分配|等待).{0,10}(?:资源|设备|空间|锁|对象)|(?:资源|设备|空间|锁).{0,10}(?:请求|持有|占用|分配|等待)/.test(text)) return "allocation";
  if (/分类/.test(title) && /可.+不可|优点.+缺点/.test(text)) return "comparison";
  if (/状态|转换|迁移|状态机/.test(text)) return "state";
  if (/必要条件|组成|层次|结构|体系/.test(title)) return "hierarchy";
  if (/循环|周期|轮转|生命周期/.test(cycleTitle)) return "cycle";
  if (/循环|周期|轮转|反复|往复|生命周期/.test(cycleText)) return "cycle";
  if (/对比|比较|区别|相同|不同|优点|缺点|\bvs\.?\b/i.test(text)) return "comparison";
  if (/步骤|流程|过程|阶段|首先|然后|接着|最后|算法/.test(text)) return "flow";
  if (/原因|导致|引起|因此|结果|影响|因果|依赖/.test(text)) return "cause";
  if (/分为|分类|包括|组成|层次|结构|体系|条件/.test(text)) return "hierarchy";
  return "reveal";
}

const animationReasons = {
  flow: "内容具有明确的时序或执行顺序，适合逐步推进。",
  cycle: "内容包含循环或反馈关系，适合环形路径动画。",
  comparison: "内容存在对照维度，适合左右并行与差异强调。",
  cause: "内容存在因果或依赖关系，适合链式传导动画。",
  hierarchy: "内容存在分类、组成或必要条件，适合从核心向外展开。",
  reveal: "内容适合逐层揭示，用节奏控制降低一次性信息负担。",
  state: "内容描述状态及迁移方向，适合用状态节点表现变化。",
  allocation: "内容包含两类对象之间的请求、占用或分配关系，适合用分配网络展示。",
  trajectory: "内容包含位置、数值或移动顺序，适合映射到坐标轨迹。",
};

function animationScore(slide, items, type) {
  let score = Math.min(items.length, 6) * 1.2;
  if (type !== "reveal") score += 3;
  if (slide.media.images || slide.media.charts || slide.media.diagrams) score += 1;
  if (/\d/.test(`${slide.title}${items.join("")}`)) score += 0.5;
  return score;
}

function requestRelevance(request, slide, items) {
  if (!request) return 0;
  const text = `${slide.title}\n${items.join("\n")}`;
  const cues = new Map([
    ["必要条件", 4], ["解决", 3], ["起因", 3], ["定义", 3],
    ["算法", 3], ["流程", 2], ["分类", 2], ["对比", 2],
    ["原理", 2], ["重点", 1], ["难点", 1],
  ]);
  let score = 0;
  for (const [cue, weight] of cues) {
    if (!request.includes(cue)) continue;
    if (slide.title.includes(cue)) score += weight;
    else if (text.includes(cue)) score += 0.5;
  }
  return score;
}

function attachScenes(analysis) {
  const sceneErrors = [];
  const animations = analysis.animations.flatMap((motion) => {
    try {
      return [{
        ...motion,
        artifact: motion.artifact || { renderer: "svg", exportFormats: ["html", "svg"] },
        scene: motion.scene || buildScene(motion),
      }];
    } catch (error) {
      sceneErrors.push(`${motion.title}：${error.message}`);
      return [];
    }
  });
  const withScenes = {
    ...analysis,
    animations,
    warnings: [...(analysis.warnings || []), ...sceneErrors.map((message) => `已跳过证据不足的动效：${message}`)],
  };
  const visualTypes = [...new Set(withScenes.animations.map((motion) => motion.scene.visualType || motion.scene.renderer))];
  const relationCount = withScenes.animations.reduce((sum, motion) => sum + (motion.scene.relations?.length || 0), 0);
  const modelWorkflow = analysis.engine === "llm-knowledge-workflow";
  return {
    ...withScenes,
    pipeline: modelWorkflow ? [
      { id: "evidence", label: "分块理解课件", output: `${analysis.workflow?.evidenceUnits || 0} 个证据单元` },
      { id: "outline", label: "生成教学大纲", output: `${analysis.sections.length} 个教学单元` },
      { id: "knowledge", label: "逐知识点深析", output: `${analysis.workflow?.knowledgePointAnalyses || analysis.keyPoints.length} 次独立推理` },
      { id: "lesson", label: "编排本节教学设计", output: `${analysis.lessonPlan?.flow?.length || 0} 个课堂环节` },
      { id: "storyboard", label: "自由生成专属动效", output: `${withScenes.animations.length} 个 SVG 场景 · 不使用类型模板` },
    ] : [
      { id: "parse", label: "本地解析课件", output: `${analysis.sections.length} 个页面线索` },
      { id: "knowledge", label: "规则提取候选", output: `${analysis.keyPoints.length} 个诊断候选` },
      { id: "relations", label: "规则匹配关系", output: `${relationCount} 条候选关系` },
      { id: "storyboard", label: "本地场景预览", output: visualTypes.map((type) => withScenes.animations.find((motion) => motion.scene.visualType === type)?.scene.visualTypeLabel).filter(Boolean).join(" · ") || "无" },
    ],
  };
}

function buildAnimationCandidates(deck, request = "") {
  const candidates = [];
  const visualValue = { trajectory: 7, allocation: 6, mechanism: 6, cause: 5, state: 5, cycle: 5, flow: 4, comparison: 4, hierarchy: 2, reveal: 1 };
  for (const slide of mergeRepeatedTitleSlides(deck.slides)) {
    const items = slideItems(slide, 8);
    if (items.length < 2) continue;
    const type = detectAnimationType(slide, items);
    const candidate = {
      id: `anim-${slide.number}`,
      slideNumber: slide.number,
      slideNumbers: slide.slideNumbers,
      title: slide.title,
      type,
      reason: animationReasons[type],
      items,
      score: animationScore(slide, items, type) + requestRelevance(request, slide, items),
      teachingQuestion: `“${conciseSentence(slide.title, 18)}”中什么在变化？`,
      narration: "先确认对象与关系，再观察变化。",
    };
    const previewScene = buildScene(candidate);
    candidate.plannedVisualType = previewScene.visualType;
    candidate.score += (visualValue[previewScene.visualType] || 0) + Math.min(3, previewScene.relations?.length || 0);
    if (/^(第\s*\d+\s*章|内容导航|目录|本章学习结束)|知识导图/.test(slide.title)) candidate.score -= 9;
    candidates.push(candidate);
  }

  const selected = [];
  const typeCounts = new Map();
  for (const item of candidates.sort((a, b) => b.score - a.score || a.slideNumber - b.slideNumber)) {
    const diversityType = item.plannedVisualType || item.type;
    const count = typeCounts.get(diversityType) || 0;
    if (count >= 2 && selected.length < 4) continue;
    selected.push(item);
    typeCounts.set(diversityType, count + 1);
    if (selected.length >= 6) break;
  }
  return selected;
}

function buildSections(deck) {
  return deck.slides
    .filter((slide) => isUsefulLine(slide.title))
    .map((slide) => ({ title: slide.title, slideNumber: slide.number }))
    .filter((item, index, all) => index === 0 || canonical(item.title) !== canonical(all[index - 1].title))
    .slice(0, 16);
}

function heuristicAnalysis(deck, request) {
  const keyPoints = buildKeyPoints(deck);
  const animations = buildAnimationCandidates(deck, request);
  return {
    engine: "structure-and-semantics",
    title: deck.title,
    overview: `已从 ${deck.slideCount} 页课件中提炼 ${keyPoints.length} 个重点，并筛选 ${animations.length} 个值得用图形和运动解释的内容单元。`,
    analysisRequest: request || "提取知识重点，并识别适合动画化的内容。",
    sections: buildSections(deck),
    keyPoints,
    animations,
    warnings: ["当前为开发测试使用的本地规则诊断，不代表 AI 生成结果。正式页面不会自动降级到此模式。"],
  };
}

export async function analyzeDeck(deck, { analysisRequest = "", useLlm = true, llmClient, onProgress, onCheckpoint, deferMotion = false } = {}) {
  if (!useLlm) return attachScenes(heuristicAnalysis(deck, analysisRequest));
  const client = llmClient || createLlmClientFromEnv();
  const analysis = await runSemanticWorkflow({ deck, analysisRequest, client, onProgress, onCheckpoint, deferMotion });
  return attachScenes(analysis);
}
