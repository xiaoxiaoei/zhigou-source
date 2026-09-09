export function orderedCourseUnits(course = {}, units = []) {
  const members = (Array.isArray(units) ? units : []).filter(unit => !unit.isDemo && unit.course === course.name);
  const byId = new Map(members.map(unit => [unit.id, unit]));
  const ordered = (Array.isArray(course.unitOrder) ? course.unitOrder : []).map(id => byId.get(id)).filter(Boolean);
  const included = new Set(ordered.map(unit => unit.id));
  return [...ordered, ...members.filter(unit => !included.has(unit.id))];
}

export function moveCourseUnit(course = {}, units = [], unitId = "", direction = 0) {
  const ordered = orderedCourseUnits(course, units);
  const index = ordered.findIndex(unit => unit.id === unitId);
  const target = index + Math.sign(Number(direction) || 0);
  if (index < 0 || target < 0 || target >= ordered.length) return false;
  [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
  course.unitOrder = ordered.map(unit => unit.id);
  return true;
}

export function summarizeCourse(course = {}, units = []) {
  const members = orderedCourseUnits(course, units);
  const ready = members.filter(unit => unit.status === "可授课").length;
  const average = members.length ? Math.round(members.reduce((sum, unit) => sum + (Number(unit.completion) || 0), 0) / members.length) : 0;
  const gaps = {
    knowledge: members.filter(unit => !(unit.keyPoints || []).length).length,
    evidence: members.filter(unit => (unit.keyPoints || []).some(point => !(point.evidence || []).some(item => String(item?.quote || "").trim().length >= 4 && evidenceIsActive(unit,item)) || point.evidenceReview?.status === "needs-review")).length,
    lesson: members.filter(unit => !(unit.lesson?.flow || []).length).length,
    activity: members.filter(unit => { const report = assessActivityQuality(unit); return report.total > 0 && report.ready < report.total; }).length,
    resources: members.filter(unit => !((unit.resources || []).length + (unit.animations || []).length) || (() => { const codes = assessCodeQuality(unit), labs = assessLabQuality(unit), cases = assessCaseQuality(unit), links = assessResourceKnowledgeLinks(unit); return codes.ready < codes.total || labs.ready < labs.total || cases.ready < cases.total || links.ready < links.total; })()).length,
    assessment: members.filter(unit => { const report = assessDiagnosticQuality(unit); return !report.total || report.ready < report.total || !report.coverageReady || !report.duplicateReady || !report.diversityReady; }).length,
    alignment: members.filter(unit => { const report = buildTeachingAlignment(unit); return report.total > 0 && (report.complete < report.total || report.confirmed < report.total || report.activityStructuralComplete < report.activityTotal); }).length,
  };
  return { total: members.length, ready, average, gaps };
}

export function buildPreparationQueue(course = {}, units = [], options = {}) {
  const today = options.today instanceof Date ? options.today : new Date();
  const schedule = unit => {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(unit.scheduledDate || "") ? new Date(`${unit.scheduledDate}T00:00:00`) : null;
    if (date && !Number.isNaN(date.getTime())) {
      const localToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const days = Math.round((date - localToday) / 86400000);
      if (days < 0) return { rank: 0, days, label: `已逾期 ${Math.abs(days)} 天` };
      if (days === 0) return { rank: 0, days, label: "今天授课" };
      if (days <= 7) return { rank: 1, days, label: `${days} 天后授课` };
      return { rank: 2, days, label: `${date.getMonth() + 1}月${date.getDate()}日授课` };
    }
    const week = Math.trunc(Number(unit.teachingWeek));
    if (week > 0) return { rank: 3, days: week, label: `第 ${week} 周` };
    return { rank: 4, days: 0, label: "未排课" };
  };
  return orderedCourseUnits(course, units).flatMap((unit, index) => {
    const timing = schedule(unit), base = { unitId: unit.id, title: unit.title || "未命名教学单元", order: index + 1, scheduleLabel: timing.label, scheduleRank: timing.rank, scheduleDistance: timing.days };
    if (unit.pendingAnalysis) return [{ ...base, kind: "review", label: "审阅中间成果", description: "重新分析留下了可选择采纳的内容，当前版本尚未被覆盖。", cost: "本机操作" }];
    if (!(unit.keyPoints || []).length) return [{ ...base, kind: "analyze", label: "分析本节内容", description: "尚未形成知识点、原理与常见误解。", cost: "提交后调用模型" }];
    const points = unit.keyPoints || [], unsupported = points.filter(point => !(point.evidence || []).some(item => String(item?.quote || "").trim().length >= 4 && evidenceIsActive(unit,item))).length, needsReview = points.filter(point => point.evidenceReview?.status === "needs-review").length;
    if (unsupported || needsReview) return [{ ...base, kind: "materials", label: "核对材料证据", description: unsupported ? `${unsupported} 个知识点缺少可追溯原文，先补齐材料依据再继续备课。` : `${needsReview} 个知识点的证据已被标记为需复核。`, cost: "本机核对或重新分析" }];
    if (!(unit.lesson?.flow || []).length) return [{ ...base, kind: "lesson", label: "设计课堂流程", description: "已有知识分析，但还没有可执行的课堂认知路径。", cost: "本机编辑" }];
    const activityQuality = assessActivityQuality(unit);
    if (activityQuality.ready < activityQuality.total) return [{ ...base, kind: "activity-quality", label: "完善课堂产出与反馈", description: `${activityQuality.total-activityQuality.ready} 个课堂环节仍缺少可观察的学生产出或教师形成性反馈。`, cost: "本机编辑" }];
    if (!(unit.lesson?.questions || []).length) return [{ ...base, kind: "assessment", label: "补充诊断问题", description: "课堂流程已建立，但缺少判断学生是否真正理解的证据。", cost: "本机编辑" }];
    const diagnosticQuality = assessDiagnosticQuality(unit);
    if (diagnosticQuality.ready < diagnosticQuality.total) return [{ ...base, kind: "assessment-quality", label: "完善诊断判定依据", description: `${diagnosticQuality.total-diagnosticQuality.ready} 道诊断题尚不能明确区分真正理解与关键误解。`, cost: "本机编辑" }];
    if (!diagnosticQuality.coverageReady || !diagnosticQuality.duplicateReady || !diagnosticQuality.diversityReady) return [{ ...base, kind: "assessment-set", label: "完善诊断题组覆盖", description: `${diagnosticQuality.uncoveredKnowledge.length} 个知识点尚未覆盖，${diagnosticQuality.duplicatePairs.length} 组题目高度重复，当前包含 ${diagnosticQuality.levelsUsed.length} 种认知层次。`, cost: "本机编辑" }];
    if (!((unit.resources || []).length + (unit.animations || []).length)) return [{ ...base, kind: "resources", label: "准备教学资源", description: "知识与课堂结构已具备，仍缺少案例、实验、代码或动效。", cost: "本机编辑" }];
    const codeQuality = assessCodeQuality(unit);
    if (codeQuality.ready < codeQuality.total) return [{ ...base, kind: "resources", label: "完善代码演示", description: `${codeQuality.total-codeQuality.ready} 项代码演示仍缺少运行环境、初始条件、观察重点或有效追踪帧。`, cost: "本机编辑" }];
    const labQuality = assessLabQuality(unit);
    if (labQuality.ready < labQuality.total) return [{ ...base, kind: "resources", label: "完善实验任务", description: `${labQuality.total-labQuality.ready} 项实验仍缺少可执行步骤、可验收提交物或完整评分量规。`, cost: "本机编辑" }];
    const caseQuality = assessCaseQuality(unit);
    if (caseQuality.ready < caseQuality.total) return [{ ...base, kind: "resources", label: "完善教学案例", description: `${caseQuality.total-caseQuality.ready} 项案例仍缺少决策冲突、递进问题或回到原理的教师收束。`, cost: "本机编辑" }];
    const resourceLinks = assessResourceKnowledgeLinks(unit);
    if (resourceLinks.ready < resourceLinks.total) return [{ ...base, kind: "resources", label: "关联教学资源", description: `${resourceLinks.total-resourceLinks.ready} 项代码、实验或案例尚未说明服务哪个知识点。`, cost: "本机编辑" }];
    const alignment = buildTeachingAlignment(unit);
    if (alignment.total && (alignment.structuralComplete < alignment.total || alignment.activityStructuralComplete < alignment.activityTotal)) return [{ ...base, kind: "alignment", label: "补齐教学对齐", description: `${alignment.total-alignment.structuralComplete} 项学习目标链、${alignment.activityTotal-alignment.activityStructuralComplete} 个课堂活动链尚未完整，共 ${alignment.gaps+alignment.activityGaps} 个缺口。`, cost: "本机校正" }];
    if (alignment.total && alignment.complete < alignment.total) return [{ ...base, kind: "alignment", label: "核对目标依据", description: `${alignment.total-alignment.complete} 项学习目标关联的知识原文尚未完成教师核对。`, cost: "本机核对" }];
    if (alignment.total && alignment.confirmed < alignment.total) return [{ ...base, kind: "alignment", label: "确认教学对齐", description: `系统已给出关系建议，仍有 ${alignment.total-alignment.confirmed} 项学习目标需要教师确认。`, cost: "本机确认" }];
    if (unit.status !== "可授课") return [{ ...base, kind: "readiness", label: "进行授课检查", description: "核心内容已具备，检查证据、可用性与剩余阻塞项。", cost: "本机检查" }];
    return [];
  }).map(item => ({ ...item, cost: `${item.scheduleLabel} · ${item.cost}` })).sort((a, b) => a.scheduleRank - b.scheduleRank || a.scheduleDistance - b.scheduleDistance || a.order - b.order);
}
import { evidenceIsActive } from "./material-library.js";
import { buildTeachingAlignment } from "./teaching-alignment.js";
import { assessActivityQuality } from "./activity-quality.js";
import { assessDiagnosticQuality } from "./diagnostic-quality.js";
import { assessLabQuality } from "./lab-quality.js";
import { assessCaseQuality } from "./case-quality.js";
import { assessCodeQuality } from "./code-quality.js";
import { assessResourceKnowledgeLinks } from "./resource-quality.js";
