function value(input = "") { return String(input || "").trim(); }
function esc(input = "") { return value(input).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])); }

const observablePattern = /代码|程序|报告|截图|日志|数据|表格|图|记录|结果|清单|文件|模型|作品|演示|提交|测试|输出|轨迹|配置/;
const actionPattern = /运行|实现|编写|配置|观察|记录|比较|测量|测试|调试|修改|分析|绘制|提交|验证|构建|部署|复现|解释|定位|计算|设计/;
const vagueObjectivePattern = /^(?:了解|熟悉|掌握|学习|认识|理解)(?:本实验|相关|基本|主要|内容|知识|原理|方法|过程|技术)*[。.!！]?$/;

export function assessLabResource(resource = {}, index = 0) {
  const details = resource.details || {}, objective = value(details.objective), deliverables = value(details.deliverables);
  const steps = Array.isArray(details.steps) ? details.steps.map(value).filter(Boolean) : [];
  const rubric = Array.isArray(details.rubric) ? details.rubric.map(item => ({ criterion: value(item?.criterion), standard: value(item?.standard), points: Number(item?.points || 0) })) : [];
  const objectiveReady = objective.length >= 10 && !vagueObjectivePattern.test(objective) && (actionPattern.test(objective) || observablePattern.test(objective));
  const executableSteps = steps.filter(step => step.length >= 6 && actionPattern.test(step)).length;
  const stepsReady = steps.length >= 3 && executableSteps === steps.length;
  const deliverablesReady = deliverables.length >= 8 && observablePattern.test(deliverables);
  const completeRubric = rubric.filter(item => item.criterion.length >= 2 && item.standard.length >= 4 && item.points > 0);
  const rubricReady = completeRubric.length >= 2 && completeRubric.length === rubric.length;
  const totalPoints = rubric.reduce((sum, item) => sum + Math.max(0, item.points), 0);
  const issues = [];
  if (!objectiveReady) issues.push("实验目标缺少可观察的操作或结果");
  if (!stepsReady) issues.push(steps.length < 3 ? "实验步骤少于 3 步" : `${steps.length - executableSteps} 个步骤缺少可执行动作`);
  if (!deliverablesReady) issues.push("提交物没有说明可验收证据");
  if (!rubricReady) issues.push("评分量规至少需要 2 个完整维度");
  return { index, title: value(resource.title) || `实验任务 ${index + 1}`, objective, deliverables, steps, rubric, objectiveReady, stepsReady, executableSteps, deliverablesReady, rubricReady, totalPoints, ready: objectiveReady && stepsReady && deliverablesReady && rubricReady, issues };
}

export function assessLabQuality(unit = {}) {
  const resources = Array.isArray(unit.resources) ? unit.resources : [];
  const rows = resources.map((resource, index) => ({ resource, index })).filter(item => item.resource?.type === "lab").map((item, labIndex) => ({ ...assessLabResource(item.resource, labIndex), resourceIndex: item.index }));
  return { rows, total: rows.length, ready: rows.filter(row => row.ready).length, objectiveReady: rows.filter(row => row.objectiveReady).length, stepsReady: rows.filter(row => row.stepsReady).length, deliverablesReady: rows.filter(row => row.deliverablesReady).length, rubricReady: rows.filter(row => row.rubricReady).length };
}

export function createLabQualityPanel({ getUnit, onEdit } = {}) {
  const style = document.createElement("link"); style.rel = "stylesheet"; style.href = "./lab-quality.css"; document.head.append(style);
  function render() {
    const panel = document.querySelector("#resourcesPanel"); if (!panel) return;
    panel.querySelector(".lab-quality-panel")?.remove();
    const report = assessLabQuality(getUnit()); if (!report.total) return;
    panel.insertAdjacentHTML("beforeend", `<section class="lab-quality-panel"><header><div><span class="section-kicker">LAB QUALITY</span><h2>实验任务质量检查</h2></div><div><b>${report.ready}/${report.total}</b><small>项可直接使用</small></div></header><div class="lab-quality-list">${report.rows.map(row => `<article class="${row.ready ? "ready" : "risk"}"><span><i class="ph ${row.ready ? "ph-check-circle" : "ph-warning-circle"}"></i></span><div><h3>${esc(row.title)}</h3><p>${row.issues.length ? row.issues.map(esc).join(" · ") : "目标、步骤、提交物与评分量规完整"}</p><small>${row.steps.length} 个步骤 · ${row.rubric.length} 个评分维度 · ${row.totalPoints} 分</small></div><button class="button outline" type="button" data-edit-lab-quality="${row.resourceIndex}">${row.ready ? "查看实验" : "完善实验"}</button></article>`).join("")}</div><footer><span>目标 ${report.objectiveReady}/${report.total} · 步骤 ${report.stepsReady}/${report.total} · 提交物 ${report.deliverablesReady}/${report.total} · 量规 ${report.rubricReady}/${report.total}</span></footer></section>`);
    panel.querySelectorAll("[data-edit-lab-quality]").forEach(button => button.addEventListener("click", () => onEdit?.(Number(button.dataset.editLabQuality))));
  }
  return { render, report: () => assessLabQuality(getUnit()) };
}
