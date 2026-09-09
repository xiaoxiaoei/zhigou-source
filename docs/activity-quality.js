function value(text = "") { return String(text || "").trim(); }
function esc(text = "") { return value(text).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])); }

const observablePattern = /写|画|标|提交|说明|解释|判断|选择|预测|实现|运行|调试|比较|计算|展示|回答|记录|修改|设计|构建|归纳|定位|复现|验证/;
const feedbackPattern = /检查|对照|追问|点评|反馈|展示|统计|纠正|提示|比较|核对|讲评|投票|诊断|标记|回应|修正/;
const passivePattern = /^(听讲|听课|了解|学习|观看|参与讨论|认真听讲)[。.]?$/;

export function assessActivityQuality(unit = {}) {
  const flow = Array.isArray(unit.lesson?.flow) ? unit.lesson.flow : [], target = Number.parseInt(unit.duration, 10) || 0;
  const rows = flow.map((step, index) => {
    const studentAction = value(step.studentAction), studentOutput = value(step.studentOutput), feedback = value(step.feedback), minutes = Number(step.minutes) || 0;
    const actionReady = studentAction.length >= 6 && !passivePattern.test(studentAction);
    const outputReady = studentOutput.length >= 4 && (observablePattern.test(studentOutput) || studentOutput.length >= 10);
    const feedbackReady = feedback.length >= 6 && (feedbackPattern.test(feedback) || feedback.length >= 14);
    const timingRisk = minutes > 0 && (minutes < 5 || minutes > 35);
    const issues = [];
    if (!actionReady) issues.push("学生活动过于笼统");
    if (!outputReady) issues.push("缺少可观察产出");
    if (!feedbackReady) issues.push("缺少形成性反馈");
    if (timingRisk) issues.push(minutes < 5 ? "时间可能不足" : "单一环节时间过长");
    return { index, phase: value(step.phase) || `课堂环节 ${index + 1}`, minutes, studentAction, studentOutput, feedback, actionReady, outputReady, feedbackReady, timingRisk, issues, ready: actionReady && outputReady && feedbackReady };
  });
  const totalMinutes = rows.reduce((sum, row) => sum + row.minutes, 0), difference = target ? totalMinutes - target : 0;
  return { rows, total: rows.length, ready: rows.filter(row => row.ready).length, outputReady: rows.filter(row => row.outputReady).length, feedbackReady: rows.filter(row => row.feedbackReady).length, timingRisks: rows.filter(row => row.timingRisk).length, totalMinutes, targetMinutes: target, durationDifference: difference, durationReady: !target || Math.abs(difference) <= Math.max(10, target * 0.15) };
}

export function createActivityQualityPanel({ getUnit, onEdit } = {}) {
  const style = document.createElement("link"); style.rel = "stylesheet"; style.href = "./activity-quality.css"; document.head.append(style);
  function render() {
    const panel = document.querySelector("#lessonPanel"); if (!panel) return;
    panel.querySelector(".activity-quality-panel")?.remove();
    const report = assessActivityQuality(getUnit());
    if (!report.total) return;
    panel.insertAdjacentHTML("beforeend", `<section class="activity-quality-panel"><header><div><span class="section-kicker">ACTIVITY EVIDENCE</span><h2>课堂活动质量检查</h2></div><div class="activity-quality-score"><b>${report.ready}/${report.total}</b><small>环节完整</small></div></header><div class="activity-quality-list">${report.rows.map(row => `<article class="${row.ready ? "ready" : "risk"}"><div><small>${String(row.index + 1).padStart(2, "0")} · ${row.minutes} 分钟</small><h3>${esc(row.phase)}</h3><p>${row.issues.length ? row.issues.map(esc).join(" · ") : "活动、产出与反馈已完整"}</p></div><dl><div><dt>学生可观察产出</dt><dd>${esc(row.studentOutput || "尚未填写")}</dd></div><div><dt>教师形成性反馈</dt><dd>${esc(row.feedback || "尚未填写")}</dd></div></dl></article>`).join("")}</div><footer><span>${report.outputReady}/${report.total} 项有产出 · ${report.feedbackReady}/${report.total} 项有反馈${report.durationReady ? "" : ` · 总时长偏差 ${Math.abs(report.durationDifference)} 分钟`}</span><button class="button outline" type="button" data-edit-activity-quality><i class="ph ph-pencil-simple"></i> 完善课堂活动</button></footer></section>`);
    panel.querySelector("[data-edit-activity-quality]")?.addEventListener("click", () => onEdit?.());
  }
  return { render, report: () => assessActivityQuality(getUnit()) };
}
