function value(input = "") { return String(input || "").trim(); }
function esc(input = "") { return value(input).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])); }

const conflictPattern = /但是|然而|冲突|权衡|限制|故障|异常|争议|风险|成本|性能|安全|时间|资源|约束|两难|取舍|无法同时|相反/;
const observePattern = /哪些|什么|找出|指出|识别|现象|事实|发生了什么|问题在哪里|证据/;
const explainPattern = /为什么|为何|原因|机制|分析|解释|导致|如何发生|依据/;
const decidePattern = /如果|方案|选择|改进|权衡|设计|建议|决策|如何处理|怎么办|最小修改|取舍/;
const closurePattern = /收束|回到|强调|归纳|总结|联系|目标|原理|边界|误解|证据|结论|对照/;

function questionLevel(question = "") {
  const text = value(question);
  if (decidePattern.test(text)) return "decide";
  if (explainPattern.test(text)) return "explain";
  if (observePattern.test(text)) return "observe";
  return "unclear";
}

export function assessCaseResource(resource = {}, index = 0) {
  const details = resource.details || {}, context = value(details.context), scenario = value(details.scenario), teachingNotes = value(details.teachingNotes);
  const questions = Array.isArray(details.questions) ? details.questions.map(value).filter(Boolean) : [];
  const questionLevels = questions.map(questionLevel), observeAt = questionLevels.indexOf("observe"), explainAt = questionLevels.indexOf("explain"), decideAt = questionLevels.indexOf("decide");
  const contextReady = context.length >= 8;
  const scenarioReady = scenario.length >= 24 && conflictPattern.test(scenario);
  const questionsReady = questions.length >= 3 && questions.every(question => question.length >= 6 && /[?？]|为什么|为何|如何|哪些|什么|找出|指出|识别|分析|解释|选择|设计|建议|权衡|如果/.test(question));
  const progressionReady = questionsReady && observeAt >= 0 && explainAt > observeAt && decideAt > explainAt;
  const closureReady = teachingNotes.length >= 16 && closurePattern.test(teachingNotes);
  const issues = [];
  if (!contextReady) issues.push("案例背景缺少角色或使用情境");
  if (!scenarioReady) issues.push("案例材料缺少需要权衡的冲突或约束");
  if (!questionsReady) issues.push("讨论问题至少需要 3 个可回答任务");
  else if (!progressionReady) issues.push("问题没有按识别—解释—决策递进");
  if (!closureReady) issues.push("教师收束没有回到原理、边界或学习目标");
  return { index, title: value(resource.title) || `教学案例 ${index + 1}`, context, scenario, teachingNotes, questions, questionLevels, contextReady, scenarioReady, questionsReady, progressionReady, closureReady, ready: contextReady && scenarioReady && progressionReady && closureReady, issues };
}

export function assessCaseQuality(unit = {}) {
  const resources = Array.isArray(unit.resources) ? unit.resources : [];
  const rows = resources.map((resource, index) => ({ resource, index })).filter(item => item.resource?.type === "case").map((item, caseIndex) => ({ ...assessCaseResource(item.resource, caseIndex), resourceIndex: item.index }));
  return { rows, total: rows.length, ready: rows.filter(row => row.ready).length, contextReady: rows.filter(row => row.contextReady).length, scenarioReady: rows.filter(row => row.scenarioReady).length, progressionReady: rows.filter(row => row.progressionReady).length, closureReady: rows.filter(row => row.closureReady).length };
}

export function createCaseQualityPanel({ getUnit, onEdit } = {}) {
  const style = document.createElement("link"); style.rel = "stylesheet"; style.href = "/case-quality.css"; document.head.append(style);
  function render() {
    const panel = document.querySelector("#resourcesPanel"); if (!panel) return;
    panel.querySelector(".case-quality-panel")?.remove();
    const report = assessCaseQuality(getUnit()); if (!report.total) return;
    panel.insertAdjacentHTML("beforeend", `<section class="case-quality-panel"><header><div><span class="section-kicker">CASE QUALITY</span><h2>教学案例质量检查</h2></div><div><b>${report.ready}/${report.total}</b><small>项可直接使用</small></div></header><div class="case-quality-list">${report.rows.map(row => `<article class="${row.ready ? "ready" : "risk"}"><span><i class="ph ${row.ready ? "ph-check-circle" : "ph-warning-circle"}"></i></span><div><h3>${esc(row.title)}</h3><p>${row.issues.length ? row.issues.map(esc).join(" · ") : "情境、冲突、递进问题与教师收束完整"}</p><small>${row.questions.length} 个问题 · ${row.progressionReady ? "识别 → 解释 → 决策" : "递进关系待完善"}</small></div><button class="button outline" type="button" data-edit-case-quality="${row.resourceIndex}">${row.ready ? "查看案例" : "完善案例"}</button></article>`).join("")}</div><footer><span>背景 ${report.contextReady}/${report.total} · 冲突 ${report.scenarioReady}/${report.total} · 递进问题 ${report.progressionReady}/${report.total} · 教师收束 ${report.closureReady}/${report.total}</span></footer></section>`);
    panel.querySelectorAll("[data-edit-case-quality]").forEach(button => button.addEventListener("click", () => onEdit?.(Number(button.dataset.editCaseQuality))));
  }
  return { render, report: () => assessCaseQuality(getUnit()) };
}
