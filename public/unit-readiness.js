import { assessMotionQuality } from "./motion-quality.js";
import {reviewTargets,currentReview} from './teaching-case.js';
import { evidenceIsActive } from "./material-library.js";
import { buildTeachingAlignment } from "./teaching-alignment.js";
import { assessActivityQuality } from "./activity-quality.js";
import { assessDiagnosticQuality } from "./diagnostic-quality.js";
import { assessLabQuality } from "./lab-quality.js";
import { assessCaseQuality } from "./case-quality.js";
import { assessCodeQuality } from "./code-quality.js";
import { assessResourceKnowledgeLinks } from "./resource-quality.js";

function hasText(value, minimum = 1) {
  return String(value || "").trim().length >= minimum;
}

function hasEvidence(point = {}, unit = {}) {
  return Array.isArray(point.evidence) && point.evidence.some(item => hasText(item?.quote, 4) && evidenceIsActive(unit, item));
}

function resourceIsUsable(resource = {}, unit = {}) {
  const details = resource.details || {};
  if (!hasText(resource.title) || !hasText(resource.purpose, 6)) return false;
  if (resource.type === "code") return hasText(details.code, 3) && hasText(details.walkthrough, 6);
  if (resource.type === "lab") return hasText(details.objective, 6) && Array.isArray(details.steps) && details.steps.some(item => hasText(item, 4)) && hasText(details.deliverables, 4);
  if (resource.type === "case") return hasText(details.context, 6) && hasText(details.scenario, 10) && Array.isArray(details.questions) && details.questions.some(item => hasText(item, 4));
  if (resource.type === "motion") return (unit.animations || []).some(motion => { const latest = Array.isArray(motion.versions) && motion.versions.length ? motion.versions.at(-1) : motion; return assessMotionQuality(latest).ready && latest.qualityReview?.status !== "needs-revision"; });
  return true;
}

function durationMinutes(value) {
  const match = String(value || "").match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function criterion(id, label, pass, detail, tab, required = true) {
  return { id, label, pass: Boolean(pass), detail, tab, required };
}

export function assessUnitReadiness(unit = {}) {
  const points = Array.isArray(unit.keyPoints) ? unit.keyPoints : [];
  const objectives = Array.isArray(unit.objectives) ? unit.objectives.filter(item => hasText(item, 4)) : [];
  const flow = Array.isArray(unit.lesson?.flow) ? unit.lesson.flow : [];
  const questions = Array.isArray(unit.lesson?.questions) ? unit.lesson.questions : [];
  const afterClass = Array.isArray(unit.lesson?.afterClass) ? unit.lesson.afterClass : [];
  const resources = Array.isArray(unit.resources) ? unit.resources : [];
  const supported = points.filter(point => hasEvidence(point, unit)).length;
  const caseReviewRisks=reviewTargets(unit).filter(t=>['stale','needs-revision'].includes(currentReview(unit,t).status));
  const reviewed = points.filter(point => point.evidenceReview?.status === "verified").length;
  const needsReview = points.filter(point => point.evidenceReview?.status === "needs-review").length;
  const flowMinutes = flow.reduce((sum, item) => sum + (Number(item?.minutes) || 0), 0);
  const targetMinutes = durationMinutes(unit.duration);
  const durationClose = !targetMinutes || Math.abs(flowMinutes - targetMinutes) <= Math.max(10, targetMinutes * 0.15);
  const usableResources = resources.filter(resource => resourceIsUsable(resource, unit)).length;
  const draftResources = resources.filter(resource => /草稿|待继续/.test(String(resource.status || "草稿"))).length;
  const isUnanalyzedSkeleton = unit.status === "待分析" && points.length === 0 && objectives.length === 0 && flow.length === 0 && questions.length === 0 && resources.length === 0;
  const alignment = buildTeachingAlignment(unit);
  const activityQuality = assessActivityQuality(unit);
  const diagnosticQuality = assessDiagnosticQuality(unit);
  const labQuality = assessLabQuality(unit);
  const caseQuality = assessCaseQuality(unit);
  const codeQuality = assessCodeQuality(unit);
  const resourceLinks = assessResourceKnowledgeLinks(unit);
  const sections = [
    { id: "overview", label: "教学概览", weight: 15, tab: "overview", items: [
      criterion("title", "教学单元标题明确", hasText(unit.title, 4), "标题至少应能说明本节课的主题。", "overview"),
      criterion("overview", "核心问题已经说明", hasText(unit.overview, 20) && !/仍在完善|尚未/.test(String(unit.overview)), "说明学生为什么难、这节课真正要解决什么。", "overview"),
      criterion("objectives", "至少有 2 项可检验目标", objectives.length >= 2, `当前 ${objectives.length} 项。`, "overview"),
      criterion("alignment-complete", "每项目标都有知识、活动与诊断支撑", alignment.total > 0 && alignment.structuralComplete === alignment.total, `结构完整 ${alignment.structuralComplete}/${alignment.total}，仍有 ${alignment.gaps} 个含证据核对在内的缺口。`, "overview"),
      criterion("activity-alignment", "每个课堂活动都进入目标—诊断闭环", alignment.activityTotal > 0 && alignment.activityStructuralComplete === alignment.activityTotal, `已进入闭环 ${alignment.activityStructuralComplete}/${alignment.activityTotal}，仍有 ${alignment.activityGaps} 个活动反向对齐缺口。`, "overview"),
      criterion("alignment-evidence", "建议核对目标链中的材料原文", alignment.total > 0 && alignment.complete === alignment.total, `材料与完整链路 ${alignment.complete}/${alignment.total}。`, "overview", false),
      criterion("alignment-confirmed", "建议由教师确认教学对齐", alignment.total > 0 && alignment.confirmed === alignment.total, `已确认 ${alignment.confirmed}/${alignment.total} 项。`, "overview", false),
    ] },
    { id: "knowledge", label: "知识与证据", weight: 30, tab: "knowledge", items: [
      criterion("points", "已经形成知识点分析", points.length > 0, `当前 ${points.length} 个知识点。`, "knowledge"),
      criterion("logic", "知识点均有原理说明", points.length > 0 && points.every(point => hasText(point.logic || point.coreLogic || point.explanation, 8)), "不能只保留知识点名称。", "knowledge"),
      criterion("evidence", "知识点均可追溯到材料", points.length > 0 && supported === points.length, `材料依据 ${supported}/${points.length}。`, "materials"),
      criterion("review", "没有教师标记的待复核项", points.length > 0 && needsReview === 0, needsReview ? `${needsReview} 个知识点仍需复核。` : points.length ? "当前没有明确风险项。" : "需要先完成知识点分析。", "materials"),
      criterion('case-review','案例审核没有未解决或已失效的意见',points.length>0&&caseReviewRisks.length===0,points.length?`${caseReviewRisks.length} 项需在教学概览的案例与审核中处理。`:'需要先完成知识分析。','overview'),
      criterion("verified", "建议完成人工证据核对", points.length > 0 && reviewed === points.length, `已核对 ${reviewed}/${points.length}。`, "materials", false),
    ] },
    { id: "lesson", label: "教学设计", weight: 25, tab: "lesson", items: [
      criterion("flow", "至少有 3 个课堂环节", flow.length >= 3, `当前 ${flow.length} 个环节。`, "lesson"),
      criterion("actions", "每个环节都有师生活动", flow.length > 0 && flow.every(item => hasText(item.teacherAction, 6) && hasText(item.studentAction, 6) && Number(item.minutes) > 0), "教师动作、学生行为和时间均需明确。", "lesson"),
      criterion("activity-evidence", "每个环节都有学生产出与教师反馈", activityQuality.total > 0 && activityQuality.ready === activityQuality.total, `完整 ${activityQuality.ready}/${activityQuality.total}；产出 ${activityQuality.outputReady}/${activityQuality.total}；反馈 ${activityQuality.feedbackReady}/${activityQuality.total}。`, "lesson"),
      criterion("duration", "课堂环节总时长接近授课时长", flow.length > 0 && durationClose, `环节共 ${flowMinutes} 分钟，单元设置 ${targetMinutes || "未填写"} 分钟。`, "lesson", false),
      criterion("activity-timing", "建议避免过短或过长的单一环节", activityQuality.total > 0 && activityQuality.timingRisks === 0, activityQuality.timingRisks ? `${activityQuality.timingRisks} 个环节的时间分配需要复核。` : activityQuality.total ? "当前没有明显时间风险。" : "需要先建立课堂流程。", "lesson", false),
    ] },
    { id: "resources", label: "教学资源", weight: 15, tab: "resources", items: [
      criterion("resource", "至少有 1 项可直接使用的资源", usableResources > 0, `可用 ${usableResources}/${resources.length} 项。`, "resources"),
      criterion("code-quality", "代码演示具备环境、初始条件与观察重点", resources.length > 0 && (codeQuality.total === 0 || codeQuality.ready === codeQuality.total), codeQuality.total ? `可直接使用 ${codeQuality.ready}/${codeQuality.total} 项代码演示。` : "当前没有代码演示。", "resources"),
      criterion("lab-quality", "实验任务具备目标、步骤、提交物与量规", resources.length > 0 && (labQuality.total === 0 || labQuality.ready === labQuality.total), labQuality.total ? `可直接使用 ${labQuality.ready}/${labQuality.total} 项实验任务。` : "当前没有实验任务。", "resources"),
      criterion("case-quality", "教学案例具备情境、冲突、递进问题与收束", resources.length > 0 && (caseQuality.total === 0 || caseQuality.ready === caseQuality.total), caseQuality.total ? `可直接使用 ${caseQuality.ready}/${caseQuality.total} 项教学案例。` : "当前没有教学案例。", "resources"),
      criterion("resource-links", "每项结构化资源都关联具体知识点", resources.length > 0 && (resourceLinks.total === 0 || resourceLinks.ready === resourceLinks.total), `已关联 ${resourceLinks.ready}/${resourceLinks.total} 项；覆盖 ${resourceLinks.coveredPointIds.length} 个知识点。`, "resources"),
      criterion("linked-content-review", "关联内容已核对", resources.length > 0 && ![...(unit.resources || []), ...(unit.animations || []), ...(unit.lesson?.questions || []), ...(unit.lesson?.flow || [])].some(item => item.contentReview?.status === "needs-review"), "知识点修改后，请在资源工坊核对关联内容。", "resources"),
      criterion("resource-status", "建议处理资源草稿", resources.length > 0 && draftResources === 0, draftResources ? `${draftResources} 项仍是草稿或待继续。` : resources.length ? "资源状态已确认。" : "需要先建立至少一项教学资源。", "resources", false),
    ] },
    { id: "assessment", label: "互动与评价", weight: 15, tab: "assessment", items: [
      criterion("questions", "至少有 1 道诊断问题", questions.length > 0, `当前 ${questions.length} 道。`, "assessment"),
      criterion("diagnostic-quality", "每道题都能区分真正理解与关键误解", diagnosticQuality.total > 0 && diagnosticQuality.ready === diagnosticQuality.total, `可直接使用 ${diagnosticQuality.ready}/${diagnosticQuality.total}；判定依据 ${diagnosticQuality.answerReady}/${diagnosticQuality.total}；错误信号 ${diagnosticQuality.misconceptionReady}/${diagnosticQuality.total}。`, "assessment"),
      criterion("diagnostic-coverage", "核心与一般知识点均有诊断题覆盖", diagnosticQuality.total > 0 && diagnosticQuality.coverageReady, `已覆盖 ${diagnosticQuality.coverageCount}/${diagnosticQuality.coverageTotal} 个需诊断的知识点。`, "assessment"),
      criterion("diagnostic-duplicates", "诊断题组没有高度重复题", diagnosticQuality.total > 0 && diagnosticQuality.duplicateReady, diagnosticQuality.duplicatePairs.length ? `${diagnosticQuality.duplicatePairs.length} 组题干或误解高度相似。` : "当前未发现高度重复。", "assessment"),
      criterion("diagnostic-balance", "建议题组覆盖多种认知层次", diagnosticQuality.total > 0 && diagnosticQuality.diversityReady, diagnosticQuality.diversityReady ? `当前覆盖 ${diagnosticQuality.levelsUsed.length} 种认知层次。` : "三道以上题目不应全部停留在同一层次。", "assessment", false),
      criterion("after-class", "建议记录课后证据与调整", afterClass.some(item => hasText(item, 4)), `当前 ${afterClass.length} 项。`, "assessment", false),
    ] },
  ];
  if(["lesson","questions"].includes(unit.requestedDeliverables)&&!resources.length){const section=sections.find(s=>s.id==="resources");if(section)section.items=[criterion("resources-optional","本次未要求配套资源",true,"按教师选择，不强制生成额外资源。","resources",false)];}
  let score = 0;
  for (const section of sections) {
    const passed = section.items.filter(item => item.pass).length;
    section.score = Math.round((passed / section.items.length) * 100);
    score += section.weight * (passed / section.items.length);
  }
  const blockers = sections.flatMap(section => section.items).filter(item => item.required && !item.pass);
  const warnings = sections.flatMap(section => section.items).filter(item => !item.required && !item.pass);
  return { score: isUnanalyzedSkeleton ? 0 : Math.round(score), ready: blockers.length === 0, blockers, warnings, sections, flowMinutes, targetMinutes };
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

export function createReadinessInspector({ getUnit, onConfirm, onNavigate }) {
  const style = document.createElement("link"); style.rel = "stylesheet"; style.href = "/unit-readiness.css"; document.head.append(style);
  document.body.insertAdjacentHTML("beforeend", `<dialog class="create-dialog" id="readinessDialog"><div class="dialog-shell readiness-shell"><header><div><span class="readiness-kicker">TEACHING READINESS</span><h2>授课就绪检查</h2></div><button class="dialog-close" id="closeReadiness" type="button" aria-label="关闭窗口"><i class="ph ph-x"></i></button></header><div class="readiness-body"><section class="readiness-score"><div><strong id="readinessScore">0</strong><span>完成度</span></div><p><b id="readinessSummary"></b><small id="readinessDetail"></small></p></section><div id="readinessSections"></div></div><footer><span id="readinessFooterState"></span><div><button class="button outline hidden" id="fixReadiness" type="button">去完善第一项</button><button class="button dark" id="confirmReadiness" type="button">确认可授课</button></div></footer></div></dialog>`);
  const dialog = document.querySelector("#readinessDialog"); let currentAssessment = null;
  function render() {
    const unit = getUnit(); currentAssessment = assessUnitReadiness(unit);
    document.querySelector("#readinessScore").textContent = currentAssessment.score;
    document.querySelector("#readinessSummary").textContent = currentAssessment.ready ? "已满足进入课堂的必要条件" : `还有 ${currentAssessment.blockers.length} 项必须补齐`;
    document.querySelector("#readinessDetail").textContent = currentAssessment.warnings.length ? `另有 ${currentAssessment.warnings.length} 项建议改进，不阻止授课确认。` : "当前没有额外建议项。";
    document.querySelector("#readinessSections").innerHTML = currentAssessment.sections.map(section => `<section class="readiness-group"><header><h3>${escapeHtml(section.label)}</h3><span>${section.score}%</span></header>${section.items.map(item => `<button type="button" data-readiness-tab="${item.tab}" class="readiness-check ${item.pass ? "pass" : item.required ? "fail" : "warn"}"><i class="ph ${item.pass ? "ph-check-circle" : item.required ? "ph-x-circle" : "ph-warning-circle"}"></i><span><b>${escapeHtml(item.label)}</b><small>${escapeHtml(item.detail)}</small></span><em>${item.pass ? "已满足" : item.required ? "必须补齐" : "建议"}</em></button>`).join("")}</section>`).join("");
    const confirm = document.querySelector("#confirmReadiness"); confirm.disabled = !currentAssessment.ready || unit.status === "可授课"; confirm.textContent = unit.status === "可授课" ? "已确认可授课" : "确认可授课";
    document.querySelector("#fixReadiness").classList.toggle("hidden", currentAssessment.ready);
    document.querySelector("#readinessFooterState").textContent = currentAssessment.ready ? "必要条件已通过" : "系统不会覆盖未完成项";
    dialog.showModal();
  }
  document.querySelector("#closeReadiness").onclick = () => dialog.close();
  document.querySelector("#confirmReadiness").onclick = () => { if (!currentAssessment?.ready) return; onConfirm(currentAssessment); dialog.close(); };
  document.querySelector("#fixReadiness").onclick = () => { const tab = currentAssessment?.blockers[0]?.tab; dialog.close(); if (tab) onNavigate(tab); };
  document.querySelector("#readinessSections").onclick = event => { const target = event.target.closest("[data-readiness-tab]"); if (!target) return; dialog.close(); onNavigate(target.dataset.readinessTab); };
  return { open: render };
}
