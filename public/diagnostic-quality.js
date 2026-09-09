function value(input = "") { return String(input || "").trim(); }
function esc(input = "") { return value(input).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])); }

function compact(input = "") { return value(input).toLowerCase().replace(/为什么|为何|如何|请|解释|说明|判断|分析|给定|如果/g, "").replace(/[\s\p{P}\p{S}]/gu, ""); }
function tokens(input = "") {
  const source = compact(input), result = new Set(source.match(/[a-z][a-z0-9_+-]{1,}|\d+(?:\.\d+)?/g) || []);
  for (const segment of source.match(/[\u3400-\u9fff]{2,}/g) || []) for (let index = 0; index < segment.length - 1; index += 1) result.add(segment.slice(index, index + 2));
  return result;
}
function similarity(left, right) {
  const a = compact(left), b = compact(right); if (!a || !b) return 0;
  if (a === b || Math.min(a.length, b.length) >= 8 && (a.includes(b) || b.includes(a))) return 1;
  const at = tokens(a), bt = tokens(b); if (!at.size || !bt.size) return 0;
  let overlap = 0; at.forEach(token => { if (bt.has(token)) overlap += 1; });
  return (2 * overlap) / (at.size + bt.size);
}

const levelRules = [
  ["transfer", "迁移", /新情境|如果.{0,40}(?:改变|改为|换成|增加|减少)|改为|换成|反例|适用边界|迁移|推广|变体|不同条件/],
  ["apply", "应用", /给定|计算|设计|实现|调试|预测|画出|运行|修改|应用|构建|求解|编写|定位|执行顺序|执行轨迹|选择.*方案/],
  ["understand", "理解", /为什么|为何|解释|说明|比较|判断|分析|推导|如何|机制|原理|因果/],
  ["recall", "回忆", /是什么|定义|列出|指出|名称|哪个|哪些|填写/],
];
const taskPattern = /[?？]|为什么|为何|如何|解释|说明|比较|判断|分析|计算|设计|实现|预测|画出|选择|给定|写出|指出/;

export function assessDiagnosticQuestion(question = {}, index = 0) {
  const prompt = value(question.prompt || question.question), answerCue = value(question.answerCue || question.purpose), misconception = value(question.misconception);
  const [level, levelLabel] = levelRules.find(([, , pattern]) => pattern.test(prompt)) || ["unclear", "层次待明确"];
  const promptReady = prompt.length >= 8 && taskPattern.test(prompt);
  const answerReady = answerCue.length >= 4;
  const misconceptionReady = misconception.length >= 4;
  const issues = [];
  if (!promptReady) issues.push("题干缺少可执行任务");
  if (!answerReady) issues.push("缺少明确判定依据");
  if (!misconceptionReady) issues.push("未说明错误答案暴露的误解");
  if (level === "unclear") issues.push("认知层次不明确");
  return { index, prompt, answerCue, misconception, level, levelLabel, promptReady, answerReady, misconceptionReady, ready: promptReady && answerReady && misconceptionReady && level !== "unclear", issues };
}

export function findDiagnosticDuplicates(rows = []) {
  const pairs = [];
  for (let left = 0; left < rows.length; left += 1) for (let right = left + 1; right < rows.length; right += 1) {
    const promptSimilarity = similarity(rows[left].prompt, rows[right].prompt), misconceptionSimilarity = similarity(rows[left].misconception, rows[right].misconception);
    if (promptSimilarity >= .72 || misconceptionSimilarity >= .82 || promptSimilarity >= .55 && misconceptionSimilarity >= .55) pairs.push({ left, right, leftLabel: `诊断 ${String(left + 1).padStart(2, "0")}`, rightLabel: `诊断 ${String(right + 1).padStart(2, "0")}`, promptSimilarity, misconceptionSimilarity, reason: misconceptionSimilarity >= promptSimilarity ? "重复检查相同误解" : "题干任务高度相似" });
  }
  return pairs;
}

export function assessDiagnosticQuality(unit = {}) {
  const questions = Array.isArray(unit.lesson?.questions) ? unit.lesson.questions : [], rows = questions.map(assessDiagnosticQuestion);
  const levelCounts = Object.fromEntries(["recall", "understand", "apply", "transfer", "unclear"].map(level => [level, rows.filter(row => row.level === level).length]));
  const depthReady = rows.some(row => row.level === "apply" || row.level === "transfer"), levelsUsed = Object.entries(levelCounts).filter(([level, count]) => level !== "unclear" && count).map(([level]) => level), duplicatePairs = findDiagnosticDuplicates(rows);
  const alignment = buildTeachingAlignment(unit), points = Array.isArray(unit.keyPoints) ? unit.keyPoints : [], corePoints = points.map((point, index) => ({ point, entity: alignment.entities.knowledge[index] })).filter(item => item.entity && item.point.importance !== "supporting");
  const coverageRows = corePoints.map(({ point, entity }) => {
    const directQuestionRefs = questions.map((question, index) => Array.isArray(question.keyPointIds) && question.keyPointIds.map(String).includes(String(point.id || "")) ? alignment.entities.questions[index]?.ref : "").filter(Boolean);
    const linkedRows = alignment.rows.filter(row => row.knowledgeRefs.includes(entity.ref)), alignedQuestionRefs = linkedRows.flatMap(row => row.questionRefs), questionRefs = [...new Set([...directQuestionRefs, ...alignedQuestionRefs])];
    const questionLabels = questionRefs.map(ref => alignment.entities.questions.find(item => item.ref === ref)?.label).filter(Boolean), confirmed = Boolean(directQuestionRefs.length || linkedRows.some(row => row.confirmed && row.questionRefs.length));
    return { knowledgeRef: entity.ref, knowledgeId: value(point.id), label: entity.label, importance: value(point.importance) || "unspecified", questionRefs, questionLabels, covered: questionRefs.length > 0, confirmed };
  });
  const coverageReady = !coverageRows.length || coverageRows.every(row => row.covered), coverageConfirmed = !coverageRows.length || coverageRows.every(row => row.confirmed), diversityReady = rows.length < 3 || levelsUsed.length >= 2 && depthReady;
  return { rows, total: rows.length, ready: rows.filter(row => row.ready).length, answerReady: rows.filter(row => row.answerReady).length, misconceptionReady: rows.filter(row => row.misconceptionReady).length, depthReady, levelCounts, levelsUsed, diversityReady, duplicatePairs, duplicateReady: duplicatePairs.length === 0, coverageRows, coverageTotal: coverageRows.length, coverageCount: coverageRows.filter(row => row.covered).length, coverageReady, coverageConfirmed, uncoveredKnowledge: coverageRows.filter(row => !row.covered), setReady: coverageReady && duplicatePairs.length === 0 && diversityReady };
}

export function createDiagnosticQualityPanel({ getUnit, onEdit } = {}) {
  const style = document.createElement("link"); style.rel = "stylesheet"; style.href = "/diagnostic-quality.css"; document.head.append(style);
  function render() {
    const panel = document.querySelector("#assessmentPanel"); if (!panel) return;
    panel.querySelector(".diagnostic-quality-panel")?.remove();
    const report = assessDiagnosticQuality(getUnit()); if (!report.total) return;
    const coverage = report.coverageTotal ? `${report.coverageCount}/${report.coverageTotal} 个核心知识已覆盖` : "尚无可检查的核心知识";
    const markup = `<section class="diagnostic-quality-panel"><header><div><span class="section-kicker">DIAGNOSTIC QUALITY</span><h2>诊断题质量检查</h2></div><div class="diagnostic-quality-score"><b>${report.ready}/${report.total}</b><small>题可直接使用</small></div></header><div class="diagnostic-quality-list">${report.rows.map(row => `<article class="${row.ready ? "ready" : "risk"}"><span>${String(row.index + 1).padStart(2, "0")}</span><div><small class="level ${esc(row.level)}">${esc(row.levelLabel)}</small><h3>${esc(row.prompt || "题干待补充")}</h3><p>${row.issues.length ? row.issues.map(esc).join(" · ") : "题干、判定依据与错误信号已完整"}</p></div><dl><div><dt>判断依据</dt><dd>${esc(row.answerCue || "尚未填写")}</dd></div><div><dt>错误答案暴露的误解</dt><dd>${esc(row.misconception || "尚未填写")}</dd></div></dl></article>`).join("")}</div><section class="diagnostic-set-audit"><header><div><small>QUESTION SET</small><h3>诊断题组覆盖检查</h3></div><b class="${report.setReady ? "ready" : "risk"}">${report.setReady ? "题组完整" : "需要调整"}</b></header><div class="diagnostic-set-metrics"><span><b>${coverage}</b><small>${report.coverageConfirmed ? "关联已确认" : "含系统建议待确认"}</small></span><span><b>${report.duplicatePairs.length} 组重复</b><small>${report.duplicateReady ? "未发现高度相似题" : "建议合并或改换误解"}</small></span><span><b>${report.levelsUsed.length} 种层次</b><small>${report.diversityReady ? "层次分布可用" : "建议增加应用或迁移"}</small></span></div>${report.uncoveredKnowledge.length ? `<div class="diagnostic-set-issues"><b>未覆盖核心知识</b>${report.uncoveredKnowledge.map(row => `<span>${esc(row.label)}</span>`).join("")}</div>` : ""}${report.duplicatePairs.length ? `<div class="diagnostic-set-issues duplicates"><b>高度重复题组</b>${report.duplicatePairs.map(pair => `<span>${esc(pair.leftLabel)} · ${esc(pair.rightLabel)}：${esc(pair.reason)}</span>`).join("")}</div>` : ""}</section><footer><span>${report.answerReady}/${report.total} 题有判定依据 · ${report.misconceptionReady}/${report.total} 题有错误信号 · ${report.depthReady ? "已包含应用或迁移题" : "建议增加应用或迁移题"}</span><button class="button outline" type="button" data-edit-diagnostic-quality><i class="ph ph-pencil-simple"></i> 完善诊断题</button></footer></section>`;
    panel.insertAdjacentHTML("beforeend", markup);
    panel.querySelector("[data-edit-diagnostic-quality]")?.addEventListener("click", () => onEdit?.());
  }
  return { render, report: () => assessDiagnosticQuality(getUnit()) };
}

import { buildTeachingAlignment } from "./teaching-alignment.js";
