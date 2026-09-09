import { alignmentRef } from "./teaching-alignment.js";
import {inlineTeachingText} from './text-format.js';

const text = value => String(value || "").trim();
const esc = value => text(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const unique = values => [...new Set((Array.isArray(values) ? values : []).map(text).filter(Boolean))];

export function activityTimelineRef(activity = {}, index = 0) {
  return alignmentRef("activity", activity, index);
}

export function timelineItems(unit = {}) {
  const hasGeneratedMotion = (unit.animations || []).length > 0;
  const resources = (unit.resources || []).flatMap((resource, index) => {
    if (resource?.type === "motion" && hasGeneratedMotion) return [];
    return [{ kind: "resource", index, id: `resource:${resource.id || index}`, title: text(resource.title) || `教学资源 ${index + 1}`, type: resource.type || "case", activityRefs: unique(resource.activityRefs), keyPointIds: unique(resource.keyPointIds), source: resource }];
  });
  const motions = (unit.animations || []).map((motion, index) => ({ kind: "motion", index, id: `motion:${motion.id || index}`, title: text(motion.title) || `动态解释 ${index + 1}`, type: "motion", activityRefs: unique(motion.activityRefs), keyPointIds: unique([motion.keyPointId, motion.knowledgePointId, ...(motion.keyPointIds || [])]), source: motion }));
  const questions = (unit.lesson?.questions || []).map((question, index) => ({ kind: "question", index, id: `question:${question.id || index}`, title: text(question.prompt || question.question) || `诊断问题 ${index + 1}`, type: "question", activityRefs: unique(question.activityRefs), keyPointIds: unique(question.keyPointIds), source: question }));
  return [...resources, ...motions, ...questions];
}

export function buildClassroomTimeline(unit = {}) {
  const activities = (unit.lesson?.flow || []).map((activity, index) => ({ activity, index, ref: activityTimelineRef(activity, index), minutes: Math.max(1, Number(activity.minutes) || 1) }));
  let cursor = 0;
  const items = timelineItems(unit), validRefs = new Set(activities.map(row => row.ref));
  const rows = activities.map(row => {
    const start = cursor; cursor += row.minutes;
    return { ...row, start, end: cursor, items: items.filter(item => item.activityRefs.some(ref => ref === row.ref)) };
  });
  const scheduledIds = new Set(rows.flatMap(row => row.items.map(item => item.id)));
  return { rows, items, totalMinutes: cursor, targetMinutes: Number.parseInt(unit.duration, 10) || 0, unassigned: items.filter(item => !scheduledIds.has(item.id) || item.activityRefs.every(ref => !validRefs.has(ref))) };
}

function itemAt(unit, kind, index) {
  if (kind === "resource") return unit.resources?.[index];
  if (kind === "motion") return unit.animations?.[index];
  if (kind === "question") return unit.lesson?.questions?.[index];
  return null;
}

export function assignTimelineItem(unit, kind, index, activityRef = "") {
  const item = itemAt(unit, kind, Number(index));
  if (!item) return false;
  const next = activityRef ? [text(activityRef)] : [];
  if (JSON.stringify(unique(item.activityRefs)) === JSON.stringify(next)) return false;
  item.activityRefs = next;
  return true;
}

export function moveTimelineActivity(unit, fromIndex, toIndex) {
  const flow = unit.lesson?.flow;
  const from = Number(fromIndex), to = Number(toIndex);
  if (!Array.isArray(flow) || from < 0 || to < 0 || from >= flow.length || to >= flow.length || from === to) return false;
  const [activity] = flow.splice(from, 1); flow.splice(to, 0, activity); return true;
}

export function setTimelineMinutes(unit, index, minutes) {
  const activity = unit.lesson?.flow?.[Number(index)], next = Math.max(1, Math.min(240, Math.round(Number(minutes) || 0)));
  if (!activity || Number(activity.minutes) === next) return false;
  activity.minutes = next; return true;
}

export function autoArrangeTimeline(unit = {}) {
  const activities = (unit.lesson?.flow || []).map((activity, index) => ({ ref: activityTimelineRef(activity, index), keyPointIds: unique(activity.keyPointIds), index }));
  if (!activities.length) return 0;
  let changed = 0;
  timelineItems(unit).filter(item => !item.activityRefs.some(ref => activities.some(activity => activity.ref === ref))).forEach((item, itemIndex) => {
    const matches = activities.filter(activity => activity.keyPointIds.some(id => item.keyPointIds.includes(id)));
    const preferredIndex = item.type === "question" || item.type === "lab" ? matches.length - 1 : item.type === "code" ? Math.floor(matches.length / 2) : 0;
    const required=Number(item.source?.details?.estimatedMinutes)||0;
    const eligible=matches.filter(a=>!required||Number(unit.lesson.flow[a.index].minutes)>=required);
    const overlap = eligible[Math.min(Math.max(0,preferredIndex),eligible.length-1)];
    const fallback = activities[Math.min(activities.length - 1, Math.floor(itemIndex * activities.length / Math.max(1, timelineItems(unit).length)))];
    if (required && !overlap) return;
    if (item.keyPointIds.length && !overlap) return;
    if (assignTimelineItem(unit, item.kind, item.index, (overlap || fallback).ref)) changed += 1;
  });
  return changed;
}

function icon(type) {
  return ({ motion: "ph-play-circle", code: "ph-code", lab: "ph-flask", case: "ph-cards", question: "ph-question" }[type] || "ph-file");
}

export function createClassroomTimeline({ getUnit, ensureEditable, onSave, onOpenItem, onStartClassroom, onEditLesson, showToast } = {}) {
  const style = document.createElement("link"); style.rel = "stylesheet"; style.href = "./classroom-timeline.css"; document.head.append(style);
  const panel = () => document.querySelector("#timelinePanel");
  let dragged = null, suppressItemClick = false;

  function render() {
    const host = panel(); if (!host) return;
    const unit = getUnit(), report = buildClassroomTimeline(unit), delta = report.targetMinutes ? report.totalMinutes - report.targetMinutes : 0;
    if (!report.rows.length) { host.innerHTML = '<div class="panel-card empty-panel"><h2>先建立课堂环节</h2><p>点击“编辑课堂环节”添加环节。</p><button class="button dark" type="button" data-edit-timeline-lesson>编辑课堂环节</button></div>'; bind(); return; }
    const scale = Math.max(report.totalMinutes, report.targetMinutes, 1);
    host.innerHTML = `<section class="timeline-hero"><div><span class="section-kicker">CLASSROOM ORCHESTRATION</span><h2>课堂时间轴</h2><p>拖动调整顺序，点击分钟数修改时长。</p></div><div class="timeline-summary"><b>${report.totalMinutes}</b><span>/ ${report.targetMinutes || "未设置"} 分钟</span><em class="${delta > 0 ? "over" : delta < 0 ? "under" : "fit"}">${report.targetMinutes ? delta === 0 ? "课时正好" : delta > 0 ? `超出 ${delta} 分钟` : `剩余 ${Math.abs(delta)} 分钟` : "未设置目标课时"}</em></div><button class="button light" type="button" data-auto-timeline><i class="ph ph-magic-wand"></i> 自动编排未安排内容</button></section><div class="timeline-ruler">${report.rows.map(row => `<span style="width:${row.minutes / scale * 100}%"><b>${esc(row.activity.phase || `环节 ${row.index + 1}`)}</b><small>${row.minutes}′</small></span>`).join("")}</div><div class="timeline-layout"><main class="timeline-sequence">${report.rows.map((row, visualIndex) => `<article class="timeline-block" draggable="true" data-timeline-activity="${row.index}" data-activity-ref="${esc(row.ref)}"><div class="timeline-time"><b>${row.start}′</b><span>—</span><b>${row.end}′</b></div><section><header><button class="timeline-drag" type="button" aria-label="拖动课堂环节"><i class="ph ph-dots-six-vertical"></i></button><div><small>环节 ${String(visualIndex + 1).padStart(2, "0")}</small><h3>${esc(row.activity.phase || `课堂环节 ${visualIndex + 1}`)}</h3></div><label><input type="number" min="1" max="240" value="${row.minutes}" data-timeline-minutes="${row.index}"><span>分钟</span></label></header><div class="timeline-actions"><p><b>教师</b>${inlineTeachingText(row.activity.teacherAction || "待补充")}</p><p><b>学生</b>${inlineTeachingText(row.activity.studentAction || "待补充")}</p></div><div class="timeline-assets" data-timeline-drop="${esc(row.ref)}">${row.items.length ? row.items.map(item => itemChip(item)).join("") : '<p>把动效、代码、实验、案例或诊断题拖到这里</p>'}</div></section></article>`).join("")}</main><aside class="timeline-unassigned" data-timeline-drop=""><header><span class="section-kicker">RESOURCE TRAY</span><h3>待安排内容</h3><p>可拖到左侧任一课堂环节。</p></header><div>${report.unassigned.length ? report.unassigned.map(item => itemChip(item)).join("") : '<p class="timeline-all-set"><i class="ph ph-check-circle"></i> 所有内容都已进入课堂流程</p>'}</div><button class="button outline" type="button" data-edit-timeline-lesson>编辑课堂环节</button></aside></div>`;
    const autoButton = host.querySelector("[data-auto-timeline]");
    if (autoButton) { const actions = document.createElement("div"); actions.className = "timeline-hero-actions"; actions.innerHTML = '<button class="button dark" type="button" data-start-classroom><i class="ph ph-presentation-chart"></i> 开始上课</button>'; autoButton.before(actions); actions.append(autoButton); }
    bind();
  }

  function itemChip(item) { return `<button class="timeline-chip ${esc(item.type)}" type="button" draggable="true" data-timeline-item="${item.kind}:${item.index}" title="单击查看，拖动调整课堂位置" aria-label="查看${esc(item.title)}；也可拖动调整课堂位置"><i class="ph ${icon(item.type)}"></i><span><small>${item.type === "question" ? "诊断题" : item.type === "motion" ? "动态解释" : item.type === "code" ? "代码演示" : item.type === "lab" ? "实验任务" : "教学案例"}</small><b>${esc(item.title)}</b></span><i class="ph ph-eye timeline-view-icon" aria-hidden="true"></i></button>`; }

  function save(title, detail) { onSave?.(title, detail); render(); }

  function bind() {
    const host = panel(); if (!host) return;
    host.querySelector("[data-auto-timeline]")?.addEventListener("click", () => { const unit = ensureEditable(), count = autoArrangeTimeline(unit); if (!count) return showToast?.("当前没有待安排内容"); save("自动编排课堂时间轴", `已将 ${count} 项教学内容安排到课堂环节。`); showToast?.(`已自动安排 ${count} 项内容，可继续拖动调整`); });
    host.querySelector("[data-start-classroom]")?.addEventListener("click", () => onStartClassroom?.());
    host.querySelectorAll("[data-timeline-minutes]").forEach(input => input.addEventListener("change", () => { const unit = ensureEditable(); if (setTimelineMinutes(unit, input.dataset.timelineMinutes, input.value)) save("调整课堂时间轴", `${unit.lesson.flow[Number(input.dataset.timelineMinutes)]?.phase || "课堂环节"}调整为 ${input.value} 分钟。`); }));
    host.querySelectorAll("[data-edit-timeline-lesson]").forEach(button => button.addEventListener("click", () => onEditLesson?.()));
    host.querySelectorAll("[draggable=true]").forEach(element => element.addEventListener("dragstart", event => { event.stopPropagation(); if (element.dataset.timelineItem) suppressItemClick = true; dragged = element.dataset.timelineItem ? { type: "item", value: element.dataset.timelineItem } : { type: "activity", index: Number(element.dataset.timelineActivity) }; element.classList.add("dragging"); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", JSON.stringify(dragged)); }));
    host.querySelectorAll("[draggable=true]").forEach(element => element.addEventListener("dragend", event => { event.stopPropagation(); element.classList.remove("dragging"); dragged = null; setTimeout(() => { suppressItemClick = false; }, 0); host.querySelectorAll(".drag-over").forEach(node => node.classList.remove("drag-over")); }));
    host.querySelectorAll("[data-timeline-drop], [data-timeline-activity]").forEach(zone => { zone.addEventListener("dragover", event => { event.preventDefault(); event.stopPropagation(); zone.classList.add("drag-over"); }); zone.addEventListener("dragleave", event => { event.stopPropagation(); zone.classList.remove("drag-over"); }); zone.addEventListener("drop", event => { event.preventDefault(); event.stopPropagation(); zone.classList.remove("drag-over"); if (!dragged) return; const unit = ensureEditable(); if (dragged.type === "activity") { const target = Number(zone.closest("[data-timeline-activity]")?.dataset.timelineActivity); if (moveTimelineActivity(unit, dragged.index, target)) save("调整课堂环节顺序", "已通过时间轴拖动更新课堂实施顺序。"); return; } const [kind, index] = dragged.value.split(":"); const activityRef = zone.dataset.timelineDrop ?? zone.closest("[data-timeline-activity]")?.dataset.activityRef ?? ""; if (assignTimelineItem(unit, kind, index, activityRef)) save("调整课堂资源编排", activityRef ? "已把教学内容移动到新的课堂环节。" : "已把教学内容移回待安排区。"); }); });
    host.querySelectorAll("[data-timeline-item]").forEach(button => button.addEventListener("click", () => { if (suppressItemClick) return; const [kind, index] = button.dataset.timelineItem.split(":"); onOpenItem?.(kind, Number(index)); }));
  }
  return { render, report: () => buildClassroomTimeline(getUnit()), autoArrange: () => autoArrangeTimeline(ensureEditable()) };
}
