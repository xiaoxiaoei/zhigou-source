import { assessCodeQuality } from "./code-quality.js";
import { assessLabQuality } from "./lab-quality.js";
import { assessCaseQuality } from "./case-quality.js";

function value(input = "") { return String(input || "").trim(); }
function esc(input = "") { return value(input).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])); }

export function assessResourceKnowledgeLinks(unit = {}) {
  const points = Array.isArray(unit.keyPoints) ? unit.keyPoints : [], validIds = new Set(points.map(point => value(point.id)).filter(Boolean));
  const labels = new Map(points.map(point => [value(point.id), value(point.title) || "未命名知识点"]));
  const resources = Array.isArray(unit.resources) ? unit.resources : [];
  const rows = resources.map((resource, resourceIndex) => ({ resource, resourceIndex })).filter(item => ["code", "lab", "case"].includes(item.resource?.type)).map(({ resource, resourceIndex }) => {
    const requested = Array.isArray(resource.keyPointIds) ? [...new Set(resource.keyPointIds.map(value).filter(Boolean))] : [], linkedPointIds = requested.filter(id => validIds.has(id)), invalidPointIds = requested.filter(id => !validIds.has(id));
    return { resourceIndex, title: value(resource.title) || `教学资源 ${resourceIndex + 1}`, linkedPointIds, linkedLabels: linkedPointIds.map(id => labels.get(id)), invalidPointIds, ready: linkedPointIds.length > 0 };
  });
  const covered = new Set(rows.flatMap(row => row.linkedPointIds)), corePoints = points.filter(point => point.importance !== "supporting" && value(point.id));
  return { rows, total: rows.length, ready: rows.filter(row => row.ready).length, coveredPointIds: [...covered], uncoveredCorePoints: corePoints.filter(point => !covered.has(value(point.id))).map(point => ({ id: value(point.id), title: value(point.title) || "未命名知识点" })) };
}

export function assessResourceQuality(unit = {}) {
  const code = assessCodeQuality(unit), lab = assessLabQuality(unit), teachingCase = assessCaseQuality(unit), links = assessResourceKnowledgeLinks(unit);
  const linkByIndex = new Map(links.rows.map(row => [row.resourceIndex, row]));
  const structuralRows = [
    ...code.rows.map(row => ({ ...row, type: "code", typeLabel: "代码演示", meta: `${row.codeLines} 行代码 · ${row.validTraces.length} 个有效追踪帧`, enhancement: row.ready && !row.traceReady ? "静态讲解可用；可增加至少 2 个追踪帧用于课堂播放" : "" })),
    ...lab.rows.map(row => ({ ...row, type: "lab", typeLabel: "实验任务", meta: `${row.steps.length} 个步骤 · ${row.rubric.length} 个评分维度 · ${row.totalPoints} 分`, enhancement: "" })),
    ...teachingCase.rows.map(row => ({ ...row, type: "case", typeLabel: "教学案例", meta: `${row.questions.length} 个问题 · ${row.progressionReady ? "识别 → 解释 → 决策" : "递进关系待完善"}`, enhancement: "" })),
  ].sort((left, right) => left.resourceIndex - right.resourceIndex);
  const rows = structuralRows.map(row => { const link = linkByIndex.get(row.resourceIndex) || { ready: false, linkedLabels: [], invalidPointIds: [] }, structuralReady = row.ready, issues = [...row.issues]; if (!link.ready) issues.push("未关联任何有效知识点"); if (link.invalidPointIds.length) issues.push(`${link.invalidPointIds.length} 个旧关联已失效`); return { ...row, structuralReady, linkedPointIds: link.linkedPointIds || [], linkedLabels: link.linkedLabels || [], invalidPointIds: link.invalidPointIds || [], issues, meta: `${row.meta} · ${link.linkedLabels?.length ? `关联：${link.linkedLabels.join("、")}` : "知识关联待补充"}`, ready: structuralReady && link.ready && !link.invalidPointIds.length }; });
  return { rows, total: rows.length, ready: rows.filter(row => row.ready).length, structuralReady: rows.filter(row => row.structuralReady).length, code, lab, teachingCase, links };
}

export function createResourceQualityPanel({ getUnit, onEdit } = {}) {
  const style = document.createElement("link"); style.rel = "stylesheet"; style.href = "/resource-quality.css"; document.head.append(style);
  function render() {
    const panel = document.querySelector("#resourcesPanel"); if (!panel) return;
    panel.querySelector(".resource-quality-panel")?.remove();
    const report = assessResourceQuality(getUnit()); if (!report.total) return;
    panel.insertAdjacentHTML("beforeend", `<section class="resource-quality-panel"><header><div><span class="section-kicker">RESOURCE QUALITY</span><h2>教学资源质量总览</h2></div><div><b>${report.ready}/${report.total}</b><small>项可直接使用</small></div></header><div class="resource-quality-list">${report.rows.map(row => `<article class="${row.ready ? "ready" : "risk"}"><span class="resource-quality-icon ${row.type}"><i class="ph ${row.type === "code" ? "ph-code" : row.type === "lab" ? "ph-flask" : "ph-cards"}"></i></span><div><small>${row.typeLabel}</small><h3>${esc(row.title)}</h3><p>${row.issues.length ? row.issues.map(esc).join(" · ") : esc(row.enhancement || "内容与知识关联完整，可直接进入课堂核对")}</p><em>${esc(row.meta)}</em></div><button class="button outline" type="button" data-edit-resource-quality="${row.resourceIndex}">${row.ready ? "查看资源" : "完善资源"}</button></article>`).join("")}</div><footer><span>结构 ${report.structuralReady}/${report.total} · 知识关联 ${report.links.ready}/${report.links.total}</span><small>系统只检查教学结构，不执行任何代码。</small></footer></section>`);
    panel.querySelectorAll("[data-edit-resource-quality]").forEach(button => button.addEventListener("click", () => onEdit?.(Number(button.dataset.editResourceQuality))));
  }
  return { render, report: () => assessResourceQuality(getUnit()) };
}
