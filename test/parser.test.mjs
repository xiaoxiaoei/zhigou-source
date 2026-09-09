import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parsePptx } from "../src/pptx-parser.mjs";
import { analyzeDeck } from "../src/analyzer.mjs";
import { buildScene } from "../src/scene-builder.mjs";
import { standaloneSvg } from "../public/scene-runtime.js";
import { textSourceToDeck } from "../src/text-source-parser.mjs";
import { createLlmClient } from "../src/llm-client.mjs";
import { buildFreeformScene, freeformSceneQualityIssues } from "../src/freeform-scene.mjs";
import { AnalysisJobStore } from "../src/job-store.mjs";
import { moveItem } from "../public/unit-content-editor.js";
import { applyUnitSnapshot, createUnitSnapshot, snapshotEquals } from "../public/unit-versioning.js";
import { normalizeKnowledgeRelations } from "../public/knowledge-relations-editor.js";
import { buildEvidenceCandidates, normalizeEvidenceDraft, summarizeEvidenceCoverage } from "../public/source-evidence.js";
import { buildSourcePageIndex, locateQuoteInContext } from "../public/source-context.js";
import { getMaterialPageDetail, resolveMaterialSearchTarget, summarizeMaterialLedger } from "../public/material-ledger.js";
import { addTextMaterial, allMaterialPages, evidenceIsActive, listUnitMaterials, materialImpact, materialRevisionHistory, restoreMaterialRevision, searchMaterialPages, setMaterialArchived, updateTextMaterial } from "../public/material-library.js";
import { normalizeResourceDetails, validateResourceDetails } from "../public/resource-details.js";
import { normalizeTraceFrames } from "../public/code-trace-player.js";
import { buildResourcePreviewModel } from "../public/teaching-resource-preview.js";
import { createDiagnosticCheckpoint, createDiagnosticRun, diagnosticFollowUps, normalizeDiagnosticQuestions, readDiagnosticCheckpoint, removeDiagnosticCheckpoint, summarizeDiagnosticRun, validateDiagnosticCheckpoint, writeDiagnosticCheckpoint } from "../public/diagnostic-runner.js";
import { createResourceDraft, readResourceDraft, removeResourceDraft, resourceFingerprint, writeResourceDraft } from "../public/resource-drafts.js";
import { createUnitEditorDraft, readUnitEditorDraft, removeUnitEditorDraft, unitSectionFingerprint, unitSectionValue, writeUnitEditorDraft } from "../public/unit-editor-drafts.js";
import { alignmentEntities, alignmentFromSelections, buildTeachingAlignment, objectiveRef } from "../public/teaching-alignment.js";
import { assessActivityQuality } from "../public/activity-quality.js";
import { assessDiagnosticQuality, assessDiagnosticQuestion } from "../public/diagnostic-quality.js";
import { assessLabQuality, assessLabResource } from "../public/lab-quality.js";
import { assessCaseQuality, assessCaseResource } from "../public/case-quality.js";
import { assessCodeQuality, assessCodeResource } from "../public/code-quality.js";
import { assessResourceKnowledgeLinks, assessResourceQuality } from "../public/resource-quality.js";
import { buildTeachingPackageHtml } from "../public/unit-export.js";
import { addInsightImprovement, improvementProgress, toggleImprovementAction } from "../public/unit-improvement.js";
import { reuseTeachingAsset } from "../public/resource-reuse.js";
import { buildPreparationQueue, moveCourseUnit, orderedCourseUnits, summarizeCourse } from "../public/course-planning.js";
import { duplicateTeachingUnit } from "../public/unit-duplication.js";
import { assessUnitReadiness } from "../public/unit-readiness.js";
import { assessMotionQuality, buildMotionRevisionInstruction, getMotionQualityState } from "../public/motion-quality.js";
import { parseInsightCsv } from "../public/teaching-insights.js";
import { createCourseUnitSkeletons, parseCourseOutline } from "../public/course-batch.js";
import { canAnalyzeIntoUnit, mergeAnalysisIntoExistingUnit } from "../public/analysis-target.js";
import { applyPendingAnalysisSelection, summarizeAnalysisDiff } from "../public/analysis-diff.js";
import { activityTimelineRef, assignTimelineItem, autoArrangeTimeline, buildClassroomTimeline, moveTimelineActivity, setTimelineMinutes } from "../public/classroom-timeline.js";
import { deleteTeachingUnit } from "../public/unit-deletion.js";
import { classroomPhaseAt, classroomRunModel } from "../public/classroom-presenter.js";

const samplePath = process.env.TEST_PPTX_PATH || "test/fixtures/optional-sample.pptx";

test("teaching unit deletion removes the unit and its course ordering without touching demo content", () => {
  const demo = { id: "demo", isDemo: true, title: "体验示例" };
  const personal = { id: "u1", title: "进程同步" };
  const result = deleteTeachingUnit([personal, demo], [{ id: "c1", unitOrder: ["u1", "u2"] }], "u1");
  assert.equal(result.deleted, true);
  assert.equal(result.removed, personal);
  assert.deepEqual(result.units, [demo]);
  assert.deepEqual(result.courses[0].unitOrder, ["u2"]);
  assert.equal(deleteTeachingUnit([demo], [], "demo").deleted, false);
});

test("classroom mode follows the timeline clock and exposes the current phase resources", () => {
  const unit = {
    duration: "30 分钟",
    lesson: { flow: [
      { phase: "问题引入", minutes: 10 },
      { phase: "机制拆解", minutes: 20 },
    ], questions: [{ id: "q1", prompt: "为什么会覆盖？", activityRefs: [] }] },
    resources: [{ id: "r1", type: "code", title: "执行追踪", activityRefs: [] }],
    animations: [],
  };
  const rows = buildClassroomTimeline(unit).rows;
  assert.equal(classroomPhaseAt(rows, 599), 0);
  assert.equal(classroomPhaseAt(rows, 600), 1);
  assert.equal(classroomPhaseAt(rows, 99999), 1);
  const model = classroomRunModel(unit, 725);
  assert.equal(model.phaseIndex, 1);
  assert.equal(model.phaseRemainingSeconds, 1075);
  assert.equal(model.totalSeconds, 1800);
});

test("course outline parser cleans common numbering and removes duplicate headings", () => {
  const rows = parseCourseOutline(`
课程目录
# 第一章 操作系统概述
2. 进程与线程
2. 进程与线程
- 第三章 进程同步
目录
  `);
  assert.deepEqual(rows.map(row => row.title), ["第一章 操作系统概述", "进程与线程", "第三章 进程同步"]);
});

test("course batch creation produces clean local skeletons and skips same-course duplicates", () => {
  let sequence = 0;
  const result = createCourseUnitSkeletons({
    course: { id: "course-os", name: "操作系统" },
    titles: ["进程与线程", "进程同步", "内存管理"],
    duration: "100 分钟",
    existingUnits: [
      { id: "u1", course: "操作系统", title: "进程同步" },
      { id: "u2", course: "计算机网络", title: "内存管理" },
    ],
    idFactory: () => `generated-${++sequence}`,
    now: "2026-09-04T10:00:00.000Z",
  });
  assert.equal(result.skipped, 1);
  assert.deepEqual(result.units.map(unit => unit.title), ["进程与线程", "内存管理"]);
  assert.deepEqual(result.units.map(unit => unit.id), ["unit-generated-1", "unit-generated-2"]);
  assert.ok(result.units.every(unit => unit.status === "待分析" && unit.completion === 0));
  assert.ok(result.units.every(unit => unit.duration === "100 分钟" && unit.source.kind === "course-outline"));
  assert.ok(result.units.every(unit => unit.keyPoints.length === 0 && unit.resources.length === 0 && unit.animations.length === 0));
  assert.ok(result.units.every(unit => !("sourceJobId" in unit) && !("revisionJobId" in unit)));
  assert.ok(result.units.every(unit => assessUnitReadiness(unit).score === 0));
  assert.ok(result.units.every(unit => assessUnitReadiness(unit).sections.every(section => section.score === 0 || section.id === "overview")));
});

test("analysis can update a course skeleton without changing its identity or history", () => {
  const existing = {
    id: "unit-existing", title: "第三章 进程同步", course: "操作系统", chapter: "第三章 进程同步",
    duration: "100 分钟", status: "待分析", keyPoints: [], batchCreatedAt: "earlier",
    versionHistory: [{ id: "baseline" }], improvementActions: [{ id: "next", text: "保留课堂调整" }],
  };
  assert.ok(canAnalyzeIntoUnit(existing));
  const merged = mergeAnalysisIntoExistingUnit(existing, {
    id: "temporary", title: "模型改写标题", course: "错误课程", duration: "45 分钟", status: "进行中",
    keyPoints: [{ title: "临界区" }], resources: [{ title: "实验" }], animations: [],
  }, { jobId: "job-1" });
  assert.equal(merged.id, "unit-existing");
  assert.equal(merged.title, "第三章 进程同步");
  assert.equal(merged.course, "操作系统");
  assert.equal(merged.duration, "100 分钟");
  assert.equal(merged.sourceJobId, "job-1");
  assert.equal(merged.keyPoints[0].title, "临界区");
  assert.deepEqual(merged.versionHistory, [{ id: "baseline" }]);
  assert.deepEqual(merged.improvementActions, [{ id: "next", text: "保留课堂调整" }]);
  assert.equal(merged.batchCreatedAt, "earlier");
  assert.ok(!canAnalyzeIntoUnit(merged));
  assert.equal(mergeAnalysisIntoExistingUnit(existing, { keyPoints: [] }, { partial: true }).status, "待继续");
});

test("reanalysis preserves authored assets by default and quarantines partial output", () => {
  const existing = {
    id: "u1", title: "事务", course: "数据库", duration: "90 分钟", status: "进行中",
    keyPoints: [{ title: "原知识" }], lesson: { flow: [{ phase: "原课堂" }] },
    resources: [{ type: "lab", title: "并发实验" }],
    animations: [{ id: "a1", title: "事务交错", versions: [{ versionNumber: 1 }] }],
    versionHistory: [{ id: "v1" }],
  };
  const generated = {
    keyPoints: [{ title: "新知识" }], lesson: { flow: [{ phase: "新课堂" }] },
    resources: [{ type: "lab", title: "并发实验" }, { type: "case", title: "异常案例" }],
    animations: [{ id: "a2", title: "事务交错" }, { id: "a3", title: "恢复过程" }],
  };
  const complete = mergeAnalysisIntoExistingUnit(existing, generated, { jobId: "job-complete" });
  assert.deepEqual(complete.resources.map(item => item.title), ["并发实验", "异常案例"]);
  assert.deepEqual(complete.animations.map(item => item.title), ["事务交错", "恢复过程"]);
  assert.equal(complete.animations[0].versions[0].versionNumber, 1);
  const replaced = mergeAnalysisIntoExistingUnit(existing, generated, { keepResources: false, keepAnimations: false });
  assert.equal(replaced.resources.length, 2);
  assert.equal(replaced.animations[0].id, "a2");
  const partial = mergeAnalysisIntoExistingUnit(existing, generated, { jobId: "job-partial", partial: true });
  assert.equal(partial.status, "需复核");
  assert.equal(partial.keyPoints[0].title, "原知识");
  assert.equal(partial.pendingAnalysis.keyPoints[0].title, "新知识");
  assert.equal(partial.pendingAnalysis.sourceJobId, "job-partial");
});

test("pending analysis exposes section differences and applies only teacher selections", () => {
  const unit = {
    id: "u1", title: "事务", overview: "旧说明", objectives: ["旧目标"], status: "需复核",
    keyPoints: [{ id: "old", title: "原子性", logic: "旧解释" }], knowledgeRelations: [],
    lesson: { flow: [{ phase: "导入", minutes: 10 }], questions: [{ prompt: "旧题" }], afterClass: [] },
    resources: [{ type: "lab", title: "并发实验" }], animations: [{ id: "a1", title: "事务交错", versions: [{ versionNumber: 1 }] }],
    pendingAnalysis: {
      overview: "新说明", objectives: ["新目标"], sourceJobId: "job-pending", source: { kind: "outline", title: "新材料" },
      keyPoints: [{ id: "new", title: "原子性", logic: "新解释" }, { title: "隔离性" }], knowledgeRelations: [{ from: "原子性", to: "隔离性" }],
      lesson: { flow: [{ phase: "冲突案例", minutes: 15 }], questions: [{ prompt: "新题" }], afterClass: [] },
      resources: [{ type: "lab", title: "并发实验" }, { type: "case", title: "异常案例" }],
      animations: [{ id: "a2", title: "事务交错" }, { id: "a3", title: "恢复链" }],
    },
  };
  const diff = summarizeAnalysisDiff(unit);
  assert.equal(diff.find(item => item.id === "knowledge").pendingCount, 2);
  assert.ok(diff.find(item => item.id === "knowledge").items.some(item => item.label === "隔离性" && item.status === "added"));
  assert.equal(diff.find(item => item.id === "resources").changedCount, 1);
  const result = applyPendingAnalysisSelection(unit, { knowledge: true, resources: true, animations: true });
  assert.deepEqual(result.applied, ["知识点与关系", "教学资源", "知识动效"]);
  assert.equal(result.unit.overview, "旧说明");
  assert.equal(result.unit.lesson.flow[0].phase, "导入");
  assert.equal(result.unit.keyPoints[1].title, "隔离性");
  assert.deepEqual(result.unit.resources.map(item => item.title), ["并发实验", "异常案例"]);
  assert.equal(result.unit.animations[0].versions[0].versionNumber, 1);
  assert.deepEqual(result.unit.animations.map(item => item.title), ["事务交错", "恢复链"]);
  assert.equal(result.unit.pendingAnalysis, null);
  assert.equal(result.unit.sourceJobId, "job-pending");
  const untouched = applyPendingAnalysisSelection(unit, {});
  assert.equal(untouched.unit, unit);
  assert.ok(untouched.unit.pendingAnalysis);
  const granular = applyPendingAnalysisSelection(unit, { knowledge: ["隔离性"], lesson: ["flow::冲突案例", "question::新题"] });
  assert.deepEqual(granular.applied, ["知识点 1 项", "课堂内容 2 项"]);
  assert.deepEqual(granular.unit.keyPoints.map(item => item.title), ["原子性", "隔离性"]);
  assert.deepEqual(granular.unit.lesson.flow.map(item => item.phase), ["导入", "冲突案例"]);
  assert.deepEqual(granular.unit.lesson.questions.map(item => item.prompt), ["旧题", "新题"]);
});

test("structured editor reorders items without mutating the original list", () => {
  const original = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const moved = moveItem(original, 1, -1);
  assert.deepEqual(moved.map(item => item.id), ["b", "a", "c"]);
  assert.deepEqual(original.map(item => item.id), ["a", "b", "c"]);
  assert.equal(moveItem(original, 0, -1), original);
});

test("unit snapshots restore teaching content without replacing motion versions or identity", () => {
  const unit = { id: "u1", title: "第一版", overview: "原说明", objectives: ["目标一"], keyPoints: [{ id: "a", title: "知识 A" }, { id: "b", title: "知识 B" }], knowledgeRelations: [{ from: "a", to: "b", type: "prerequisite" }], lesson: { flow: [{ phase: "导入" }], questions: [], afterClass: [] }, resources: [{ title: "案例" }], improvementActions: [{ id: "fix-1", text: "增加反例", status: "pending" }], animations: [{ id: "motion-1", versions: [1, 2] }], versionHistory: [{ id: "v1" }] };
  const snapshot = createUnitSnapshot(unit);
  assert.equal(snapshot.animations, undefined);
  unit.title = "第二版";
  unit.keyPoints = [{ title: "知识 B" }];
  applyUnitSnapshot(unit, snapshot);
  assert.equal(unit.id, "u1");
  assert.equal(unit.title, "第一版");
  assert.equal(unit.keyPoints[0].title, "知识 A");
  assert.equal(unit.knowledgeRelations[0].type, "prerequisite");
  assert.equal(unit.improvementActions[0].text, "增加反例");
  assert.deepEqual(unit.animations[0].versions, [1, 2]);
  assert.deepEqual(unit.versionHistory, [{ id: "v1" }]);
  assert.ok(snapshotEquals(unit, snapshot));
  unit.knowledgeRelations = [{ from: "a", to: "b", type: "causes" }];
  applyUnitSnapshot(unit, { title: "旧格式快照" });
  assert.deepEqual(unit.knowledgeRelations, []);
});

test("knowledge relation editor rejects dangling and self-referential relations", () => {
  const result = normalizeKnowledgeRelations(
    [{ id: "a", title: "知识 A" }, { id: "b", title: "知识 B" }],
    [
      { from: "a", to: "b", type: "causes", note: "有依据" },
      { from: "a", to: "a", type: "prerequisite" },
      { from: "missing", to: "b", type: "supports" },
    ],
  );
  assert.equal(result.relations.length, 1);
  assert.deepEqual(result.relations[0], { id: result.relations[0].id, from: "a", to: "b", type: "causes", note: "有依据" });
});

test("source evidence coverage distinguishes cited, reviewed, and unsupported knowledge", () => {
  const coverage = summarizeEvidenceCoverage([
    { evidence: [{ slideNumber: 2, quote: "原文证据" }], evidenceReview: { status: "verified" } },
    { evidence: [{ slideNumber: 4, quote: "另一条证据" }], evidenceReview: { status: "needs-review" } },
    { evidence: [] },
  ]);
  assert.deepEqual(coverage, { total: 3, supported: 2, unsupported: 1, reviewed: 1, needsReview: 1 });
});

test("teacher evidence edits normalize exact quotes and never preserve stale verification", () => {
  assert.deepEqual(normalizeEvidenceDraft([{ quote: "  原文片段  ", slideNumber: "7" }, { quote: "  " }, { quote: "补充证据", slideNumber: -2, origin: "model" }]), [
    { quote: "原文片段", slideNumber: 7, origin: "teacher" },
    { quote: "补充证据", slideNumber: undefined, origin: "model" },
  ]);
  assert.deepEqual(normalizeEvidenceDraft([{ quote: "补充材料原句", slideNumber: 1, materialId: "material-book" }]), [{ quote: "补充材料原句", slideNumber: 1, materialId: "material-book", origin: "teacher" }]);
});

test("unit materials keep a backward-compatible primary source and independent page identities", () => {
  const unit = { source: { kind: "ppt", title: "主课件.pptx", slideCount: 5, pages: [{ number: 1, title: "主页", text: "主课件原文。" }] } };
  const result = addTextMaterial(unit, { role: "textbook", title: "教材摘录", content: "教材第一页也可以编号为一，但属于另一份材料。" }, () => "book");
  assert.equal(result.added, true);
  assert.deepEqual(listUnitMaterials(unit).map(material => [material.id, material.role]), [["primary", "primary"], ["material-book", "textbook"]]);
  assert.deepEqual(allMaterialPages(unit).map(page => [page.materialId, page.number]), [["primary", 1], ["material-book", 1]]);
  assert.equal(addTextMaterial(unit, { title: "", content: "有效内容" }).reason, "title");
  assert.equal(addTextMaterial(unit, { title: "短材料", content: "太短" }).reason, "content");
});

test("material edits invalidate changed quotes and archiving is reversible with impact", () => {
  const unit = { source: { title: "主课件" }, materials: [{ id: "material-book", role: "textbook", title: "教材", pages: [{ number: 1, title: "教材", text: "锁粒度影响并发度。" }] }], keyPoints: [{ title: "锁粒度", evidence: [{ materialId: "material-book", slideNumber: 1, quote: "锁粒度影响并发度。" }], evidenceReview: { status: "verified" } }] };
  assert.deepEqual(materialImpact(unit, "material-book").affectedPoints.map(point => point.title), ["锁粒度"]);
  const updated = updateTextMaterial(unit, "material-book", { role: "textbook", title: "新版教材", content: "新的教材正文不再包含旧引文。" });
  assert.equal(updated.updated, true);
  assert.ok(unit.keyPoints[0].evidence[0].invalidatedAt);
  assert.equal(evidenceIsActive(unit, unit.keyPoints[0].evidence[0]), false);
  assert.equal(unit.keyPoints[0].evidenceReview.status, "needs-review");
  delete unit.keyPoints[0].evidence[0].invalidatedAt;
  assert.equal(setMaterialArchived(unit, "material-book", true).impact.evidenceCount, 1);
  assert.equal(evidenceIsActive(unit, unit.keyPoints[0].evidence[0]), false);
  assert.equal(setMaterialArchived(unit, "material-book", false).updated, true);
  assert.equal(evidenceIsActive(unit, unit.keyPoints[0].evidence[0]), true);
});

test("material revision history records meaningful changes and safely restores an old body", () => {
  const unit = { materials: [], keyPoints: [{ title: "锁粒度", evidence: [], evidenceReview: { status: "verified" } }] };
  const added = addTextMaterial(unit, { role: "textbook", title: "教材初版", content: "锁粒度越细，并发机会通常越多。" }, () => "history");
  const material = added.material;
  unit.keyPoints[0].evidence = [{ materialId: material.id, slideNumber: 1, quote: "锁粒度越细" }];
  const initialId = material.revisions[0].id;
  updateTextMaterial(unit, material.id, { role: "teacher", title: "教师修订版", content: "锁的范围发生变化，需要重新解释。" });
  setMaterialArchived(unit, material.id, true);
  const history = materialRevisionHistory(material);
  assert.deepEqual(history.map(item => item.action), ["归档材料", "编辑材料", "创建材料"]);
  assert.match(history[1].summary, /名称.*类型.*正文/);
  const restored = restoreMaterialRevision(unit, material.id, initialId);
  assert.equal(restored.updated, true);
  assert.equal(material.title, "教材初版");
  assert.equal(material.role, "textbook");
  assert.equal(material.archivedAt, undefined);
  assert.match(material.pages[0].text, /锁粒度越细/);
  assert.equal(unit.keyPoints[0].evidence[0].invalidatedAt, undefined);
  assert.equal(unit.keyPoints[0].evidenceReview.status, "needs-review");
  assert.match(materialRevisionHistory(material)[0].action, /恢复旧版/);
  assert.equal(restoreMaterialRevision(unit, material.id, "missing").reason, "revision");
});

test("material search finds all query terms, keeps material identity, and excludes archived sources", () => {
  const unit = {
    source: { title: "并发课件", pages: [
      { number: 1, title: "锁粒度", text: "细粒度锁可以提高并发机会，但管理开销也会增加。" },
      { number: 2, title: "互斥", text: "互斥用于保护共享状态。" },
    ] },
    materials: [
      { id: "material-book", role: "textbook", title: "操作系统教材", pages: [{ number: 7, title: "并发控制", text: "锁粒度影响并发程度，也影响加锁成本。" }] },
      { id: "material-old", role: "reference", title: "旧讲义", archivedAt: "2026-09-04", pages: [{ number: 1, text: "锁粒度和并发的旧说明。" }] },
    ],
  };
  const results = searchMaterialPages(unit, "锁粒度 并发");
  assert.deepEqual(results.map(item => [item.materialId, item.pageNumber]), [["material-book", 7], ["primary", 1]]);
  assert.ok(results.every(item => item.terms.length === 2 && /锁粒度|并发/.test(item.snippet)));
  assert.deepEqual(searchMaterialPages(unit, "锁粒度 并发", { materialId: "material-book" }).map(item => item.materialTitle), ["操作系统教材"]);
  assert.equal(searchMaterialPages(unit, "锁粒度 不存在").length, 0);
  assert.equal(searchMaterialPages(unit, "").length, 0);
});

test("material search target always resolves to a real knowledge point", () => {
  const points = [{ title: "锁粒度" }, { title: "互斥" }];
  assert.deepEqual(resolveMaterialSearchTarget(points, 1), { index: 1, title: "互斥" });
  assert.deepEqual(resolveMaterialSearchTarget(points, 99), { index: 1, title: "互斥" });
  assert.deepEqual(resolveMaterialSearchTarget([{ title: "" }], -4), { index: 0, title: "知识点 1" });
  assert.equal(resolveMaterialSearchTarget([], 0), null);
});

test("saved source pages produce exact, relevance-ranked evidence candidates", () => {
  const pages = [
    { number: 2, title: "执行交错", text: "两个线程读取同一个旧值。后写入会覆盖先写入。" },
    { number: 3, title: "临界区", text: "临界区一次只允许一个执行流进入。互斥保护共享状态的关键访问。" },
  ];
  const candidates = buildEvidenceCandidates(pages, "临界区为什么需要互斥保护", { maxItems: 3 });
  assert.equal(candidates[0].pageNumber, 3);
  assert.match(candidates[0].quote, /临界区|互斥/);
  assert.ok(pages.find(page => page.number === candidates[0].pageNumber).text.includes(candidates[0].quote));
  assert.ok(candidates.length <= 3);
});

test("source context stores only referenced pages and locates exact evidence quotes", () => {
  const slides = [{ number: 1, title: "无关页", text: "不会保存" }, { number: 2, title: "共享状态", text: "前文。结果取决于执行交错。后文。" }, { number: 3, title: "另一个引用", text: "互斥保证临界区一次只有一个执行者。" }];
  const pages = buildSourcePageIndex(slides, [{ slideNumbers: [2], evidence: [{ slideNumber: 3, quote: "互斥保证临界区一次只有一个执行者。" }] }]);
  assert.deepEqual(pages.map(page => page.number), [2, 3]);
  const located = locateQuoteInContext(pages[0].text, "结果取决于执行交错。");
  assert.equal(located.found, true);
  assert.equal(located.match, "结果取决于执行交错。");
  assert.equal(locateQuoteInContext(pages[0].text, "不存在").found, false);
});

test("material ledger summarizes coverage, review state, and referenced page availability", () => {
  const ledger = summarizeMaterialLedger({ source: { kind: "ppt", title: "课件.pptx", slideCount: 8, pages: [{ number: 2, title: "状态", text: "可查看的页面上下文。" }] }, keyPoints: [
    { title: "知识 A", evidence: [{ slideNumber: 2, quote: "原文" }], evidenceReview: { status: "verified" } },
    { title: "知识 B", evidence: [{ slideNumber: 5, quote: "另一条" }], evidenceReview: { status: "needs-review" } },
    { title: "知识 C", evidence: [] },
  ] });
  assert.deepEqual({ total: ledger.total, supported: ledger.supported, verified: ledger.verified, needsReview: ledger.needsReview, missing: ledger.missing }, { total: 3, supported: 2, verified: 1, needsReview: 1, missing: 1 });
  assert.deepEqual(ledger.points.map(point => [point.status, point.action]), [["verified", "查看证据"], ["needs-review", "重新核对"], ["missing", "补充证据"]]);
  assert.deepEqual(ledger.pages.map(page => [page.number, page.available]), [[2, true], [5, false]]);
});

test("material page detail preserves full saved text and knowledge references", () => {
  const unit = { source: { pages: [{ number: 4, title: "互斥语义", text: "临界区一次只允许一个执行流进入。\n互斥保护共享状态。" }] }, keyPoints: [
    { title: "临界区", evidence: [{ slideNumber: 4, quote: "临界区一次只允许一个执行流进入。" }] },
    { title: "锁粒度", evidence: [] },
  ] };
  const detail = getMaterialPageDetail(unit, 4);
  assert.equal(detail.text, unit.source.pages[0].text);
  assert.deepEqual(detail.referencedPoints.map(point => point.title), ["临界区"]);
  assert.deepEqual(detail.points.map(point => point.title), ["临界区", "锁粒度"]);
  assert.equal(getMaterialPageDetail(unit, 9), null);
});

test("material ledger never confuses identical page numbers across different materials", () => {
  const unit = {
    source: { title: "主课件", pages: [{ number: 1, title: "主课件第一页", text: "主课件内容。" }] },
    materials: [{ id: "material-book", role: "textbook", title: "教材摘录", pages: [{ number: 1, title: "教材第一页", text: "锁粒度会影响并发度。" }] }],
    keyPoints: [{ title: "锁粒度", evidence: [{ materialId: "material-book", slideNumber: 1, quote: "锁粒度会影响并发度。" }] }],
  };
  const ledger = summarizeMaterialLedger(unit);
  assert.deepEqual(ledger.pages.map(page => [page.materialId, page.number, page.title]), [["material-book", 1, "教材第一页"]]);
  assert.equal(getMaterialPageDetail(unit, 1, "material-book").text, "锁粒度会影响并发度。");
  assert.equal(getMaterialPageDetail(unit, 1, "primary").text, "主课件内容。");
});

test("structured teaching resources require type-specific usable content", () => {
  assert.match(validateResourceDetails("code", { language: "Python", code: "", walkthrough: "观察变量" }), /演示代码/);
  assert.equal(validateResourceDetails("code", { language: "Python", code: "print(1)", walkthrough: "观察输出" }), "");
  assert.equal(validateResourceDetails("lab", { objective: "验证互斥", estimatedMinutes: 45, steps: ["运行"], deliverables: "报告", rubric: [{ criterion: "正确性", standard: "通过全部测试", points: 60 }] }), "");
  assert.equal(validateResourceDetails("case", { context: "背景", scenario: "情境", questions: ["为什么"], teachingNotes: "收束" }), "");
  assert.deepEqual(normalizeResourceDetails({ details: { language: "Java", code: "class A {}" } }, "code").language, "Java");
  assert.deepEqual(normalizeResourceDetails({ details: { steps: "准备环境\n运行测试", rubric: "正确性" } }, "lab").steps, ["准备环境", "运行测试"]);
});

test("lab quality requires an executable objective, steps, evidence, and scoring rubric", () => {
  const weak = assessLabResource({ type: "lab", title: "线程实验", details: { objective: "了解", steps: ["看看程序"], deliverables: "完成", rubric: [{ criterion: "正确", standard: "好", points: 0 }] } });
  assert.equal(weak.ready, false);
  assert.deepEqual(weak.issues, ["实验目标缺少可观察的操作或结果", "实验步骤少于 3 步", "提交物没有说明可验收证据", "评分量规至少需要 2 个完整维度"]);
  const resource = { type: "lab", title: "锁粒度实验", details: {
    objective: "比较不同加锁边界对正确性和并发度的影响",
    steps: ["运行未加锁程序并记录三次输出", "修改临界区边界并执行相同测试", "比较运行日志并解释性能差异"],
    deliverables: "提交两版代码、运行日志和结论报告",
    rubric: [{ criterion: "实现", standard: "两版代码均能运行并通过测试", points: 50 }, { criterion: "分析", standard: "报告用日志解释正确性与并发度差异", points: 50 }],
  } };
  const strong = assessLabResource(resource);
  assert.equal(strong.ready, true);
  assert.equal(strong.executableSteps, 3);
  assert.equal(strong.totalPoints, 100);
  assert.deepEqual(assessLabQuality({ resources: [{ type: "case" }, resource] }), { rows: [{ ...strong, resourceIndex: 1 }], total: 1, ready: 1, objectiveReady: 1, stepsReady: 1, deliverablesReady: 1, rubricReady: 1 });
});

test("case quality requires a decision conflict, progressive questions, and principled closure", () => {
  const weak = assessCaseResource({ type: "case", title: "网络案例", details: { context: "课堂", scenario: "系统出现问题。", questions: ["谈谈看法"], teachingNotes: "自由讨论" } });
  assert.equal(weak.ready, false);
  assert.deepEqual(weak.issues, ["案例背景缺少角色或使用情境", "案例材料缺少需要权衡的冲突或约束", "讨论问题至少需要 3 个可回答任务", "教师收束没有回到原理、边界或学习目标"]);
  const resource = { type: "case", title: "死锁处置案例", details: {
    context: "在线服务偶发无响应，开发团队需要在不停机条件下定位并修复故障。",
    scenario: "线程 A 与线程 B 以相反顺序持有并请求两把锁，但是扩大单锁范围又会降低并发度，团队需要在安全性、性能和修改成本之间权衡。",
    questions: ["从请求与持有记录中可以指出哪些异常事实？", "两个线程为什么会形成循环等待？", "如果只能做最小修改，应该选择哪种方案并说明权衡依据？"],
    teachingNotes: "先用证据确认循环等待，再收束到统一加锁顺序的原理，并强调性能与安全性的适用边界。",
  } };
  const strong = assessCaseResource(resource);
  assert.equal(strong.ready, true);
  assert.deepEqual(strong.questionLevels, ["observe", "explain", "decide"]);
  assert.deepEqual(assessCaseQuality({ resources: [{ type: "code" }, resource] }).rows[0].resourceIndex, 1);
});

test("code quality requires environment, initial conditions, observation focus, and valid traces", () => {
  const weak = assessCodeResource({ type: "code", title: "排序演示", details: { language: "", code: "TODO", walkthrough: "看代码", traceSteps: [{ line: 9, state: "", explanation: "" }] } });
  assert.equal(weak.ready, false);
  assert.deepEqual(weak.issues, ["没有说明语言或运行环境", "演示代码为空或仍是占位内容", "缺少输入、初始状态或运行前提", "没有说明学生需要观察的状态变化", "1 个追踪帧的行号、状态或解释无效"]);
  const resource = { type: "code", title: "交换过程追踪", keyPointIds: ["kp-swap"], details: {
    language: "Python 3", code: "temp = a\na = b\nb = temp", sampleInput: "a=1, b=2",
    walkthrough: "观察初始变量状态，并追踪临时变量如何避免原值丢失。",
    traceSteps: [{ line: 1, state: "temp=1", explanation: "保存 a 的旧值" }, { line: 2, state: "a=2", explanation: "把 b 写入 a" }, { line: 3, state: "b=1", explanation: "把旧值写入 b" }],
  } };
  const strong = assessCodeResource(resource);
  assert.equal(strong.ready, true);
  assert.equal(strong.traceReady, true);
  assert.equal(strong.validTraces.length, 3);
  assert.equal(assessCodeQuality({ resources: [resource] }).ready, 1);
  const overview = assessResourceQuality({ keyPoints: [{ id: "kp-swap", title: "变量交换" }], resources: [resource, { type: "lab", details: {} }, { type: "case", details: {} }] });
  assert.deepEqual(overview.rows.map(row => row.type), ["code", "lab", "case"]);
  assert.equal(overview.ready, 1);
});

test("teaching resources keep explicit knowledge links and expose stale references", () => {
  const unit = {
    keyPoints: [{ id: "kp-race", title: "竞态条件", importance: "high" }, { id: "kp-lock", title: "锁粒度", importance: "medium" }, { id: "kp-api", title: "API 语法", importance: "supporting" }],
    resources: [{ type: "code", title: "追踪器", keyPointIds: ["kp-race"] }, { type: "lab", title: "锁实验", keyPointIds: [] }, { type: "case", title: "故障案例", keyPointIds: ["kp-missing"] }, { type: "motion", title: "动效规划" }],
  };
  const report = assessResourceKnowledgeLinks(unit);
  assert.equal(report.total, 3);
  assert.equal(report.ready, 1);
  assert.deepEqual(report.rows[0].linkedLabels, ["竞态条件"]);
  assert.deepEqual(report.rows[2].invalidPointIds, ["kp-missing"]);
  assert.deepEqual(report.uncoveredCorePoints.map(point => point.title), ["锁粒度"]);
  unit.resources[1].keyPointIds = ["kp-lock"];
  unit.resources[2].keyPointIds = ["kp-race", "kp-lock"];
  assert.equal(assessResourceKnowledgeLinks(unit).ready, 3);
  const html = buildTeachingPackageHtml({ title: "并发", keyPoints: unit.keyPoints, resources: [{ type: "lab", title: "锁实验", purpose: "比较锁边界", keyPointIds: ["kp-lock"], details: {} }] });
  assert.match(html, /服务知识点：<\/b>锁粒度/);
});

test("classroom timeline auto-arranges resources and keeps drag edits in teaching data", () => {
  const unit = {
    title: "并发控制", duration: "45 分钟",
    lesson: { flow: [
      { id: "flow-observe", phase: "观察冲突", minutes: 10, teacherAction: "播放异常轨迹", studentAction: "标记错误位置", keyPointIds: ["kp-race"] },
      { id: "flow-explain", phase: "解释机制", minutes: 20, teacherAction: "拆解读改写", studentAction: "解释状态覆盖", keyPointIds: ["kp-race"] },
      { id: "flow-transfer", phase: "迁移诊断", minutes: 15, teacherAction: "给出新轨迹", studentAction: "独立预测结果", keyPointIds: ["kp-lock"] },
    ], questions: [{ id: "q-lock", prompt: "扩大锁范围会怎样？", keyPointIds: ["kp-lock"] }] },
    resources: [{ id: "r-code", type: "code", title: "读改写追踪", keyPointIds: ["kp-race"] }, { id: "r-lab", type: "lab", title: "锁粒度实验", keyPointIds: ["kp-lock"] }],
    animations: [{ id: "m-race", title: "丢失更新动效", keyPointIds: ["kp-race"] }],
  };
  assert.equal(autoArrangeTimeline(unit), 4);
  let report = buildClassroomTimeline(unit);
  assert.equal(report.totalMinutes, 45);
  assert.equal(report.unassigned.length, 0);
  assert.deepEqual(report.rows.map(row => row.items.length), [1, 1, 2]);
  assert.equal(setTimelineMinutes(unit, 0, 12), true);
  assert.equal(moveTimelineActivity(unit, 2, 1), true);
  report = buildClassroomTimeline(unit);
  assert.equal(report.totalMinutes, 47);
  assert.deepEqual(report.rows.map(row => row.activity.phase), ["观察冲突", "迁移诊断", "解释机制"]);
  assert.equal(assignTimelineItem(unit, "resource", 0, activityTimelineRef(unit.lesson.flow[1], 1)), true);
  assert.equal(buildClassroomTimeline(unit).rows[1].items.some(item => item.title === "读改写追踪"), true);
  const html = buildTeachingPackageHtml(unit);
  assert.match(html, /课堂时间轴/);
  assert.match(html, /0–12 min/);
  assert.match(html, /代码演示：读改写追踪/);
});

test("teaching resource preview models preserve usable code, lab, and case structure", () => {
  const code = buildResourcePreviewModel({ type: "code", title: "单步追踪", details: { language: "Python", code: "x += 1", walkthrough: "观察写回", traceSteps: [{ line: 1, state: "x=1", explanation: "完成更新" }] } });
  assert.equal(code.ready, true);
  assert.equal(code.count, 1);
  assert.equal(code.details.code, "x += 1");
  const lab = buildResourcePreviewModel({ type: "lab", title: "锁实验", details: { objective: "比较锁粒度", estimatedMinutes: 30, steps: ["运行粗粒度锁", "运行细粒度锁"], deliverables: "性能记录", rubric: [{ criterion: "正确性", standard: "无竞态", points: 60 }, { criterion: "分析", standard: "解释差异", points: 40 }] } });
  assert.equal(lab.ready, true);
  assert.equal(lab.count, 2);
  assert.equal(lab.totalPoints, 100);
  const teachingCase = buildResourcePreviewModel({ type: "case", title: "死锁案例", details: { context: "线上故障", scenario: "两个线程反向持锁", questions: ["循环在哪里？"], teachingNotes: "收束到循环等待" } });
  assert.equal(teachingCase.ready, true);
  assert.equal(teachingCase.count, 1);
  assert.equal(buildResourcePreviewModel({ type: "motion" }), null);
});

test("resource editor drafts recover by resource and reject stale baselines", () => {
  const values = new Map(), storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const original = { id: "resource-a", type: "code", title: "并发追踪", purpose: "观察写回", status: "草稿", keyPointIds: ["kp-race"], details: { language: "Python", code: "x += 1" } };
  const contextA = { mode: "edit", unitId: "unit-a", resourceId: original.id, baseline: resourceFingerprint(original) };
  const contextB = { mode: "edit", unitId: "unit-b", resourceId: "resource-b", baseline: "baseline-b" };
  const draftA = createResourceDraft(contextA, { type: "code", title: "并发追踪（修改中）", purpose: "观察读改写", status: "待确认", keyPointIds: ["kp-race", "kp-lock", "kp-race"], details: { language: "Python", code: "x = x + 1", walkthrough: "记录旧值" } }, 1_000);
  assert.equal(writeResourceDraft(storage, "drafts", draftA), true);
  assert.equal(readResourceDraft(storage, "drafts", contextA, { now: 2_000 }).details.walkthrough, "记录旧值");
  assert.deepEqual(readResourceDraft(storage, "drafts", contextA, { now: 2_000 }).keyPointIds, ["kp-race", "kp-lock"]);
  assert.equal(readResourceDraft(storage, "drafts", contextB, { now: 2_000 }), null);
  assert.equal(readResourceDraft(storage, "drafts", { ...contextA, baseline: "resource-changed" }, { now: 2_000 }), null);
  const newDraft = createResourceDraft({ mode: "new" }, { targetUnitId: "unit-b", type: "lab", title: "锁粒度实验", details: { steps: ["运行测试"] } }, 1_500);
  writeResourceDraft(storage, "drafts", newDraft);
  assert.equal(readResourceDraft(storage, "drafts", { mode: "new" }, { now: 2_000, unitIds: ["unit-b"] }).title, "锁粒度实验");
  assert.equal(readResourceDraft(storage, "drafts", { mode: "new" }, { now: 2_000, unitIds: ["unit-c"] }), null);
  assert.equal(removeResourceDraft(storage, "drafts", contextA), true);
  assert.equal(readResourceDraft(storage, "drafts", contextA, { now: 2_000 }), null);
  assert.equal(readResourceDraft(storage, "drafts", { mode: "new" }, { now: 2_000, unitIds: ["unit-b"] }).title, "锁粒度实验");
});

test("unit editor drafts isolate sections and never overwrite a changed saved version", () => {
  const values = new Map(), storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const unit = { id: "unit-a", title: "进程同步", course: "操作系统", duration: "90 分钟", overview: "解释竞态条件", objectives: ["定位临界区"], keyPoints: [{ title: "竞态", logic: "结果依赖交错" }], lesson: { flow: [{ phase: "反例", minutes: 10 }], questions: [{ prompt: "为什么丢失更新？" }], afterClass: ["收集轨迹图"] } };
  const overviewContext = { unitId: unit.id, section: "overview", baseline: unitSectionFingerprint(unit, "overview") };
  const knowledgeContext = { unitId: unit.id, section: "knowledge", baseline: unitSectionFingerprint(unit, "knowledge") };
  writeUnitEditorDraft(storage, "unit-drafts", createUnitEditorDraft(overviewContext, { title: "进程同步（修订）", overview: "从丢失更新切入", objectives: "解释执行交错" }, 1_000));
  writeUnitEditorDraft(storage, "unit-drafts", createUnitEditorDraft(knowledgeContext, [{ title: "竞态条件", logic: "共享状态与执行交错共同决定结果" }], 1_500));
  assert.equal(readUnitEditorDraft(storage, "unit-drafts", overviewContext, { now: 2_000 }).value.title, "进程同步（修订）");
  assert.equal(readUnitEditorDraft(storage, "unit-drafts", knowledgeContext, { now: 2_000 }).value[0].title, "竞态条件");
  assert.deepEqual(unitSectionValue(unit, "assessment").afterClass, ["收集轨迹图"]);
  const changedUnit = { ...unit, overview: "已在另一个版本更新" };
  assert.equal(readUnitEditorDraft(storage, "unit-drafts", { ...overviewContext, baseline: unitSectionFingerprint(changedUnit, "overview") }, { now: 2_000 }), null);
  assert.equal(removeUnitEditorDraft(storage, "unit-drafts", overviewContext), true);
  assert.equal(readUnitEditorDraft(storage, "unit-drafts", overviewContext, { now: 2_000 }), null);
  assert.equal(readUnitEditorDraft(storage, "unit-drafts", knowledgeContext, { now: 2_000 }).value.length, 1);
});

test("teaching alignment distinguishes suggestions, confirmed links, evidence, and gaps", () => {
  const unit = {
    objectives: ["解释竞态条件中的执行交错", "判断锁粒度是否合理"],
    keyPoints: [
      { id: "kp-race", title: "竞态条件", logic: "共享状态结果依赖执行交错", evidence: [{ quote: "两个进程并发访问共享变量" }], evidenceReview: { status: "verified" } },
      { id: "kp-lock", title: "锁粒度", logic: "保护范围影响安全性与并发度", evidence: [] },
    ],
    lesson: {
      flow: [{ id: "flow-race", phase: "轨迹拆解", teacherAction: "播放执行交错", studentAction: "标记覆盖写入", keyPointIds: ["kp-race"] }, { id: "flow-lock", phase: "边界比较", teacherAction: "展示三种锁范围", studentAction: "比较并发度", keyPointIds: ["kp-lock"] }],
      questions: [{ id: "q-race", prompt: "两次加一为什么只留下一个结果？", keyPointIds: ["kp-race"] }, { id: "q-lock", prompt: "锁住整个线程有什么代价？", keyPointIds: ["kp-lock"] }],
    },
  };
  const suggested = buildTeachingAlignment(unit);
  assert.equal(suggested.total, 2);
  assert.equal(suggested.confirmed, 0);
  assert.ok(suggested.rows[0].knowledgeRefs.length > 0);
  assert.ok(suggested.rows[0].activityRefs.length > 0);
  assert.equal(suggested.rows[0].supportedKnowledge, 1);
  assert.equal(suggested.activityTotal, 2);
  assert.equal(suggested.activityStructuralComplete, 2);
  const entities = alignmentEntities(unit);
  unit.teachingAlignment = alignmentFromSelections(unit, [
    { objectiveRef: objectiveRef(unit.objectives[0]), knowledgeRefs: [entities.knowledge[0].ref], activityRefs: [entities.activities[0].ref], questionRefs: [entities.questions[0].ref] },
    { objectiveRef: objectiveRef(unit.objectives[1]), knowledgeRefs: [entities.knowledge[1].ref, "knowledge:missing"], activityRefs: [entities.activities[1].ref], questionRefs: [] },
  ]);
  const confirmed = buildTeachingAlignment(unit);
  assert.equal(confirmed.confirmed, 2);
  assert.equal(confirmed.complete, 1);
  assert.deepEqual(confirmed.rows[0].gaps, []);
  assert.deepEqual(confirmed.rows[1].gaps, ["知识点缺少已核对原文", "缺少诊断问题"]);
  assert.equal(confirmed.rows[1].knowledgeRefs.includes("knowledge:missing"), false);
  assert.equal(confirmed.activityStructuralComplete, 1);
  assert.deepEqual(confirmed.activityRows[1].gaps, ["缺少诊断闭环"]);
  assert.deepEqual(confirmed.activityRows[0].objectiveLabels, ["解释竞态条件中的执行交错"]);
  const html = buildTeachingPackageHtml(unit);
  assert.match(html, /目标—知识—活动—评价对齐/);
  assert.match(html, /课堂活动反向证据链/);
  assert.match(html, /教师已确认/);
  assert.match(html, /知识点缺少已核对原文/);
  assert.match(html, /缺少诊断闭环/);
});

test("activity quality requires observable student output and formative feedback", () => {
  const weak = assessActivityQuality({ duration: "90 分钟", lesson: { flow: [{ phase: "讲解", minutes: 40, teacherAction: "讲解知识点", studentAction: "听讲" }, { phase: "讨论", minutes: 3, teacherAction: "组织讨论", studentAction: "参与讨论" }] } });
  assert.equal(weak.ready, 0);
  assert.equal(weak.outputReady, 0);
  assert.equal(weak.feedbackReady, 0);
  assert.equal(weak.timingRisks, 2);
  assert.ok(weak.rows[0].issues.includes("学生活动过于笼统"));
  const strong = assessActivityQuality({ duration: "30 分钟", lesson: { flow: [{ phase: "预测", minutes: 10, teacherAction: "展示执行轨迹", studentAction: "独立预测最终变量值", studentOutput: "提交变量值及一条判断理由", feedback: "统计答案分布并追问错误分支" }, { phase: "解释", minutes: 20, teacherAction: "拆解读改写过程", studentAction: "标记覆盖写入位置", studentOutput: "画出带状态值的执行时间线", feedback: "对照关键帧检查并纠正读取边界" }] } });
  assert.equal(strong.ready, 2);
  assert.equal(strong.outputReady, 2);
  assert.equal(strong.feedbackReady, 2);
  assert.equal(strong.durationReady, true);
  const html = buildTeachingPackageHtml({ title: "并发课堂", lesson: { flow: [{ phase: "预测", minutes: 10, teacherAction: "展示执行轨迹", studentAction: "独立预测最终变量值", studentOutput: "提交变量值及一条判断理由", feedback: "统计答案分布并追问错误分支" }] } });
  assert.match(html, /可观察产出/);
  assert.match(html, /提交变量值及一条判断理由/);
  assert.match(html, /形成性反馈/);
  assert.match(html, /统计答案分布并追问错误分支/);
});

test("diagnostic quality distinguishes executable prompts, evidence cues, misconceptions, and cognitive depth", () => {
  const weak = assessDiagnosticQuality({ lesson: { questions: [{ prompt: "信号量是什么？" }, { prompt: "讨论死锁", answerCue: "自由发挥", misconception: "不清楚" }] } });
  assert.equal(weak.ready, 0);
  assert.equal(weak.levelCounts.recall, 1);
  assert.equal(weak.levelCounts.unclear, 1);
  assert.equal(weak.depthReady, false);
  assert.ok(weak.rows[0].issues.includes("缺少明确判定依据"));
  assert.ok(weak.rows[1].issues.includes("认知层次不明确"));
  const strong = assessDiagnosticQuality({ lesson: { questions: [{ prompt: "两次加一为什么可能只留下一个结果？", answerCue: "两个线程在任一方写回前读取同一旧值", misconception: "认为加一语句天然具有原子性" }, { prompt: "如果把调度顺序换成 A读、A写、B读、B写，结果会如何改变？", answerCue: "B 读取 A 已写回的新值，最终结果为 2", misconception: "认为只要并发执行就必然丢失更新" }] } });
  assert.equal(strong.ready, 2);
  assert.equal(strong.levelCounts.understand, 1);
  assert.equal(strong.levelCounts.transfer, 1);
  assert.equal(strong.depthReady, true);
  assert.equal(assessDiagnosticQuestion(strong.rows[1]).level, "transfer");
  const html = buildTeachingPackageHtml({ title: "并发诊断", lesson: { questions: [{ prompt: "如果改变调度顺序，结果如何变化？", answerCue: "根据新的读写时序判断", misconception: "认为并发必然出错" }] } });
  assert.match(html, /诊断 01 · 迁移/);
});

test("diagnostic set quality finds duplicate misconceptions, uncovered core knowledge, and narrow level distribution", () => {
  const unit = {
    keyPoints: [{ id: "kp-race", title: "竞态条件", importance: "high" }, { id: "kp-lock", title: "锁粒度", importance: "medium" }, { id: "kp-api", title: "API 语法", importance: "supporting" }],
    lesson: { questions: [
      { prompt: "两次加一为什么只留下一个结果？", answerCue: "两个线程在写回前读取同一旧值", misconception: "认为加一语句天然具有原子性", keyPointIds: ["kp-race"] },
      { prompt: "两个线程执行加一为何最终可能只增加一次？", answerCue: "两次计算基于同一个被读取的旧值", misconception: "认为加一语句天然具有原子性", keyPointIds: ["kp-race"] },
      { prompt: "请解释竞态条件的结果为什么依赖执行交错？", answerCue: "不同读写相对顺序会改变被覆盖的值", misconception: "认为线程调度不会影响共享状态", keyPointIds: ["kp-race"] },
    ] },
  };
  const weak = assessDiagnosticQuality(unit);
  assert.equal(weak.ready, 3);
  assert.equal(weak.coverageTotal, 2);
  assert.equal(weak.coverageCount, 1);
  assert.deepEqual(weak.uncoveredKnowledge.map(row => row.label), ["锁粒度"]);
  assert.ok(weak.duplicatePairs.some(pair => pair.left === 0 && pair.right === 1));
  assert.equal(weak.diversityReady, false);
  assert.equal(weak.setReady, false);
  unit.lesson.questions = [unit.lesson.questions[0], { prompt: "如果把锁从临界区扩大到整个线程，并发度会如何改变？", answerCue: "互斥仍正确，但无关代码也被串行化，并发度降低", misconception: "认为锁范围越大就只会提高安全性而没有代价", keyPointIds: ["kp-lock"] }];
  const strong = assessDiagnosticQuality(unit);
  assert.equal(strong.coverageCount, 2);
  assert.equal(strong.duplicatePairs.length, 0);
  assert.equal(strong.setReady, true);
  const html = buildTeachingPackageHtml(unit);
  assert.match(html, /诊断题组覆盖/);
  assert.match(html, /2\/2 个核心与一般知识点/);
  assert.match(html, /未发现高度重复题/);
});

test("classroom diagnosis records outcomes and turns observed gaps into follow-up actions", () => {
  const questions = normalizeDiagnosticQuestions([{ question: "锁为什么不能包住整个线程？", purpose: "并发度下降", misconception: "锁越大越安全" }, { prompt: "死锁循环在哪里？", answerCue: "请求—持有环" }]);
  const run = createDiagnosticRun(questions, { id: "run-1", now: "2026-09-04T10:00:00.000Z" });
  run.observations[0].result = "confused";
  run.observations[0].note = "多数学生只考虑正确性";
  run.observations[1].result = "incomplete";
  run.status = "completed";
  run.completedAt = "2026-09-04T10:10:00.000Z";
  assert.deepEqual(summarizeDiagnosticRun(run), { total: 2, understood: 0, confused: 1, incomplete: 1, unobserved: 0 });
  const followUps = diagnosticFollowUps(run);
  assert.equal(followUps.length, 2);
  assert.match(followUps[0].adjustment, /重新设计诊断与讲解/);
  assert.equal(followUps[0].evidence, "多数学生只考虑正确性");
  assert.match(followUps[1].adjustment, /补做课堂诊断/);
  const html = buildTeachingPackageHtml({ title: "并发", lesson: { questions, diagnosticRuns: [run] } });
  assert.match(html, /最近课堂诊断记录/);
  assert.match(html, /1 题出现误解/);
  assert.match(html, /多数学生只考虑正确性/);
});

test("diagnostic checkpoints restore only the matching unit and unchanged question set", () => {
  const values = new Map(), storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const unitA = { id: "unit-a", lesson: { questions: [{ prompt: "问题 A", answerCue: "依据 A" }] } };
  const unitB = { id: "unit-b", lesson: { questions: [{ prompt: "问题 B", answerCue: "依据 B" }] } };
  const runA = createDiagnosticRun(unitA.lesson.questions, { id: "run-a" });
  runA.observations[0].result = "confused";
  const checkpointA = createDiagnosticCheckpoint(unitA.id, unitA.lesson.questions, runA, 0, [{ answer: true, misconception: false }]);
  assert.equal(writeDiagnosticCheckpoint(storage, "active", checkpointA), true);
  assert.equal(readDiagnosticCheckpoint(storage, "active", unitA).run.id, "run-a");
  assert.equal(readDiagnosticCheckpoint(storage, "active", unitB), null);
  const runB = createDiagnosticRun(unitB.lesson.questions, { id: "run-b" });
  writeDiagnosticCheckpoint(storage, "active", createDiagnosticCheckpoint(unitB.id, unitB.lesson.questions, runB));
  assert.equal(readDiagnosticCheckpoint(storage, "active", unitA).run.id, "run-a");
  assert.equal(readDiagnosticCheckpoint(storage, "active", unitB).run.id, "run-b");
  const changedA = { ...unitA, lesson: { questions: [{ prompt: "已经修改的问题 A" }] } };
  assert.equal(validateDiagnosticCheckpoint(checkpointA, changedA).reason, "questions");
  assert.equal(readDiagnosticCheckpoint(storage, "active", changedA), null);
  assert.equal(removeDiagnosticCheckpoint(storage, "active", unitA.id), true);
  assert.equal(readDiagnosticCheckpoint(storage, "active", unitA), null);
  assert.equal(readDiagnosticCheckpoint(storage, "active", unitB).run.id, "run-b");
});

test("guided code trace clamps lines and never embeds a code execution path", async () => {
  const normalized = normalizeTraceFrames({
    details: {
      code: "x = 0\na = x + 1\nx = a",
      traceSteps: [
        { line: 2, state: "x=0, a=1", explanation: "保存局部结果" },
        { line: 99, state: "x=1", explanation: "写回共享变量" },
      ],
    },
  });
  assert.deepEqual(normalized.codeLines, ["x = 0", "a = x + 1", "x = a"]);
  assert.deepEqual(normalized.frames.map(frame => frame.line), [2, 3]);
  assert.equal(normalized.frames[0].state, "x=0, a=1");
  const source = await fs.readFile(new URL("../public/code-trace-player.js", import.meta.url), "utf8");
  assert.match(source, /引导式追踪，不执行代码/);
  assert.doesNotMatch(source, /child_process|\bexec\s*\(|\bspawn\s*\(|\beval\s*\(|new\s+Function\s*\(/);
});

test("teacher package export is printable, evidence-aware, and escapes untrusted content", () => {
  const html = buildTeachingPackageHtml({
    title: "并发 <script>alert(1)</script>", course: "操作系统", duration: "90 分钟", overview: "解释竞态条件", source: { title: "并发控制课件.pptx", slideCount: 8 },
    objectives: ["画出执行轨迹"],
    keyPoints: [{ title: "丢失更新", explanation: "写入发生覆盖", evidence: [{ slideNumber: 6, quote: "后写入覆盖前写入" }] }],
    lesson: { flow: [{ phase: "观察", minutes: 10, teacherAction: "播放轨迹", studentAction: "独立预测结果", studentOutput: "提交变量值及判断理由", feedback: "统计结果并追问错误分支" }], questions: [{ prompt: "结果为何为1？", answerCue: "读取同一旧值" }], afterClass: ["收集解释"] },
    resources: [{ type: "code", title: "追踪器", purpose: "观察状态", details: { language: "Python", code: "x < 2", traceSteps: [{ line: 1, state: "x=1", explanation: "写回" }] } }],
  });
  assert.match(html, /<!doctype html>/);
  assert.match(html, /并发控制课件\.pptx · 第 6 页/);
  assert.match(html, /引导式代码追踪（不执行代码）/);
  assert.match(html, /@media print/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /并发 &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test("teacher package names supplemental materials and excludes archived evidence", () => {
  const unit = { title: "锁粒度", source: { title: "主课件" }, materials: [{ id: "material-book", role: "textbook", title: "操作系统教材", pages: [{ number: 1, title: "摘录", text: "锁范围影响并发度。" }] }], keyPoints: [{ title: "锁粒度", evidence: [{ materialId: "material-book", slideNumber: 1, quote: "锁范围影响并发度。" }] }] };
  const active = buildTeachingPackageHtml(unit);
  assert.match(active, /操作系统教材 · 第 1 页/);
  assert.match(active, /教材摘录：<\/b>操作系统教材/);
  unit.materials[0].archivedAt = new Date().toISOString();
  const archived = buildTeachingPackageHtml(unit);
  assert.match(archived, /操作系统教材（已归档）/);
  assert.doesNotMatch(archived, /操作系统教材 · 第 1 页/);
  assert.match(archived, /未关联原文证据/);
});

test("teaching insight becomes an idempotent, completable next-lesson action", () => {
  const unit = { improvementActions: [] };
  const record = { id: "insight-1", evidence: "18 人中 11 人混淆读写时刻", issue: "没有区分读、改、写", adjustment: "先预测两条交错轨迹，再播放覆盖写入动效" };
  const first = addInsightImprovement(unit, record);
  const duplicate = addInsightImprovement(unit, record);
  assert.equal(first.added, true);
  assert.equal(duplicate.added, false);
  assert.equal(unit.improvementActions.length, 1);
  assert.deepEqual(improvementProgress(unit), { total: 1, done: 0, pending: 1, percent: 0 });
  const completed = toggleImprovementAction(unit, first.action.id, "2026-09-04T12:00:00.000Z");
  assert.equal(completed.status, "done");
  assert.deepEqual(improvementProgress(unit), { total: 1, done: 1, pending: 0, percent: 100 });
  toggleImprovementAction(unit, first.action.id);
  assert.equal(unit.improvementActions[0].status, "pending");
});

test("teaching package exports next-iteration actions and their evidence", () => {
  const html = buildTeachingPackageHtml({ title: "测试单元", improvementActions: [{ text: "增加状态转换对比", evidence: "多数学生漏掉写回时刻", issue: "只看代码行，没有追踪状态", status: "done" }] });
  assert.match(html, /下一版备课调整/);
  assert.match(html, /增加状态转换对比/);
  assert.match(html, /多数学生漏掉写回时刻/);
  assert.match(html, /已落实/);
});

test("resource reuse creates an independent, traceable copy and blocks accidental duplicates", () => {
  const source = { id: "source", title: "来源单元", resources: [{ id: "lab-1", type: "lab", title: "并发实验", status: "可授课", details: { steps: ["运行", "比较"] } }] };
  const target = { id: "target", resources: [] };
  const result = reuseTeachingAsset({ sourceUnit: source, targetUnit: target, kind: "resource", index: 0, idFactory: () => "copy-1" });
  assert.equal(result.added, true);
  assert.equal(target.resources[0].id, "resource-copy-1");
  assert.equal(target.resources[0].status, "待确认");
  assert.equal(target.resources[0].reusedFrom.unitId, "source");
  target.resources[0].details.steps.push("提交");
  assert.deepEqual(source.resources[0].details.steps, ["运行", "比较"]);
  assert.equal(reuseTeachingAsset({ sourceUnit: source, targetUnit: target, kind: "resource", index: 0 }).reason, "duplicate");
});

test("motion reuse preserves versions but removes paid-job identity", () => {
  const source = { id: "source", title: "来源单元", animations: [{ id: "motion-1", title: "状态变化", currentVersion: 2, versions: [{ versionNumber: 1, revisionJobId: "job-a" }, { versionNumber: 2, revisionJobId: "job-b" }] }] };
  const target = { id: "target", animations: [] };
  const result = reuseTeachingAsset({ sourceUnit: source, targetUnit: target, kind: "motion", index: 0, idFactory: () => "copy-motion" });
  assert.equal(result.added, true);
  assert.equal(target.animations[0].id, "motion-copy-motion");
  assert.deepEqual(target.animations[0].versions.map(item => item.versionId), ["motion-copy-motion-v1", "motion-copy-motion-v2"]);
  assert.ok(target.animations[0].versions.every(item => item.revisionJobId === ""));
  target.animations[0].versions[0].versionNumber = 9;
  assert.equal(source.animations[0].versions[0].versionNumber, 1);
});

test("course map preserves an explicit teaching order and appends new units safely", () => {
  const course = { name: "操作系统", unitOrder: ["u2", "missing", "u1"] };
  const units = [{ id: "u1", course: "操作系统" }, { id: "u2", course: "操作系统" }, { id: "u3", course: "操作系统" }, { id: "x", course: "数据库" }];
  assert.deepEqual(orderedCourseUnits(course, units).map(unit => unit.id), ["u2", "u1", "u3"]);
  assert.equal(moveCourseUnit(course, units, "u1", 1), true);
  assert.deepEqual(course.unitOrder, ["u2", "u3", "u1"]);
  assert.equal(moveCourseUnit(course, units, "u2", -1), false);
});

test("course summary reports real preparation gaps rather than only unit count", () => {
  const course = { name: "操作系统" };
  const units = [
    { id: "u1", course: "操作系统", status: "可授课", completion: 90, keyPoints: [{}], lesson: { flow: [{}], questions: [{}] }, resources: [{}] },
    { id: "u2", course: "操作系统", status: "草稿", completion: 40, keyPoints: [], lesson: { flow: [], questions: [] }, resources: [], animations: [] },
  ];
  assert.deepEqual(summarizeCourse(course, units), { total: 2, ready: 1, average: 65, gaps: { knowledge: 1, evidence: 1, lesson: 1, activity: 1, resources: 1, assessment: 2, alignment: 0 } });
});

test("course preparation queue gives one concrete next action per unit in teaching order", () => {
  const course = { name: "操作系统", unitOrder: ["review", "skeleton", "lesson", "assessment", "resources", "check", "ready"] };
  const supportedPoint = { id: "kp-supported", evidence: [{ quote: "可追溯的材料原文" }] };
  const qualityStep = { phase: "解释", minutes: 10, teacherAction: "展示并拆解执行过程", studentAction: "标出关键状态变化", studentOutput: "提交带标记的状态轨迹", feedback: "对照正确轨迹检查并追问差异" };
  const qualityQuestion = { prompt: "给定这条执行轨迹，请预测最终状态并说明理由？", answerCue: "根据读取、计算和写回的先后顺序判断", misconception: "认为每条语句都是不可分割的原子操作", keyPointIds: ["kp-supported"] };
  const complete = { keyPoints: [supportedPoint], lesson: { flow: [qualityStep], questions: [qualityQuestion] }, resources: [{}] };
  const units = [
    { id: "skeleton", title: "单元二", course: "操作系统", keyPoints: [], lesson: { flow: [], questions: [] } },
    { id: "review", title: "单元一", course: "操作系统", pendingAnalysis: {}, keyPoints: [supportedPoint], lesson: { flow: [{}], questions: [{}] }, resources: [{}] },
    { id: "lesson", title: "单元三", course: "操作系统", keyPoints: [supportedPoint], lesson: { flow: [], questions: [] } },
    { id: "assessment", title: "单元四", course: "操作系统", keyPoints: [supportedPoint], lesson: { flow: [qualityStep], questions: [] } },
    { id: "resources", title: "单元五", course: "操作系统", keyPoints: [supportedPoint], lesson: { flow: [qualityStep], questions: [qualityQuestion] }, resources: [], animations: [] },
    { id: "check", title: "单元六", course: "操作系统", status: "进行中", ...complete },
    { id: "ready", title: "单元七", course: "操作系统", status: "可授课", ...complete },
  ];
  const queue = buildPreparationQueue(course, units);
  assert.deepEqual(queue.map(item => [item.unitId, item.kind]), [["review", "review"], ["skeleton", "analyze"], ["lesson", "lesson"], ["assessment", "assessment"], ["resources", "resources"], ["check", "readiness"]]);
  assert.ok(queue[0].cost.endsWith("本机操作"));
  assert.ok(queue[1].cost.endsWith("提交后调用模型"));
});

test("course preparation queue stops at missing or disputed source evidence", () => {
  const course = { name: "操作系统", unitOrder: ["missing", "review"] };
  const common = { course: "操作系统", lesson: { flow: [{ phase: "解释" }], questions: [{ prompt: "为什么" }] }, resources: [{ title: "案例" }] };
  const units = [
    { ...common, id: "missing", title: "缺证据", keyPoints: [{ title: "竞态条件", evidence: [] }] },
    { ...common, id: "review", title: "待复核", keyPoints: [{ title: "临界区", evidence: [{ quote: "临界区需要互斥访问" }], evidenceReview: { status: "needs-review" } }] },
  ];
  const queue = buildPreparationQueue(course, units);
  assert.deepEqual(queue.map(item => [item.unitId, item.kind]), [["missing", "materials"], ["review", "materials"]]);
  assert.match(queue[0].description, /1 个知识点缺少/);
  assert.match(queue[1].description, /1 个知识点.*需复核/);
});

test("course preparation queue stops at incomplete diagnostic-set coverage", () => {
  const course = { name: "操作系统" };
  const unit = {
    id: "diagnostic-set", title: "并发控制", course: "操作系统",
    keyPoints: [
      { id: "kp-race", title: "竞态条件", importance: "high", evidence: [{ quote: "执行交错会改变共享变量结果" }] },
      { id: "kp-lock", title: "锁粒度", importance: "medium", evidence: [{ quote: "锁范围会影响程序并发度" }] },
    ],
    lesson: {
      flow: [{ phase: "解释", minutes: 15, teacherAction: "播放执行轨迹", studentAction: "标出覆盖写入", studentOutput: "提交带状态值的时间线", feedback: "对照关键帧检查错误位置" }],
      questions: [{ prompt: "两次加一为什么只留下一个结果？", answerCue: "两个线程在写回前读取同一旧值", misconception: "认为加一语句天然具有原子性", keyPointIds: ["kp-race"] }],
    },
    resources: [{ title: "执行轨迹" }],
  };
  const [item] = buildPreparationQueue(course, [unit]);
  assert.equal(item.kind, "assessment-set");
  assert.match(item.description, /1 个知识点尚未覆盖/);
  assert.match(item.description, /1 种认知层次/);
});

test("course preparation queue surfaces a weak experiment before readiness", () => {
  const course = { name: "操作系统" }, point = { id: "kp-lock", title: "锁粒度", evidence: [{ quote: "锁范围会影响并发度" }] };
  const unit = {
    id: "weak-lab", title: "锁粒度实验", course: "操作系统", keyPoints: [point],
    lesson: {
      flow: [{ phase: "实验", minutes: 20, teacherAction: "展示测试要求并巡视", studentAction: "运行程序并比较结果", studentOutput: "提交带数据的比较表", feedback: "对照测试结果检查并指出锁边界问题" }],
      questions: [{ prompt: "如果扩大锁范围，并发度会如何改变？", answerCue: "无关代码被串行化，并发度下降", misconception: "认为锁越大只有安全收益", keyPointIds: ["kp-lock"] }],
    },
    resources: [{ type: "lab", title: "锁实验", purpose: "比较不同锁边界对并发度的影响", details: { objective: "了解锁", steps: ["看看结果"], deliverables: "完成", rubric: [] } }],
  };
  const [item] = buildPreparationQueue(course, [unit]);
  assert.equal(item.kind, "resources");
  assert.equal(item.label, "完善实验任务");
  assert.match(item.description, /1 项实验/);
  assert.equal(summarizeCourse(course, [unit]).gaps.resources, 1);
});

test("course preparation queue surfaces a weak code demonstration before readiness", () => {
  const course = { name: "程序设计" }, point = { id: "kp-swap", title: "变量交换", evidence: [{ quote: "临时变量用于保存被覆盖前的值" }] };
  const unit = {
    id: "weak-code", title: "变量交换", course: "程序设计", keyPoints: [point],
    lesson: {
      flow: [{ phase: "追踪", minutes: 20, teacherAction: "展示代码并逐行推进", studentAction: "记录每行后的变量状态", studentOutput: "提交完整变量状态表", feedback: "对照正确状态检查并纠正覆盖位置" }],
      questions: [{ prompt: "如果删除临时变量，交换结果会如何改变？", answerCue: "第一个赋值覆盖旧值，后续无法恢复", misconception: "认为赋值不会改变后续读取", keyPointIds: ["kp-swap"] }],
    },
    resources: [{ type: "code", title: "交换演示", purpose: "观察赋值顺序与状态覆盖", details: { language: "Python", code: "TODO", walkthrough: "看看代码" } }],
  };
  const [item] = buildPreparationQueue(course, [unit]);
  assert.equal(item.kind, "resources");
  assert.equal(item.label, "完善代码演示");
  assert.match(item.description, /1 项代码演示/);
  assert.equal(summarizeCourse(course, [unit]).gaps.resources, 1);
});

test("course preparation queue surfaces a weak teaching case before readiness", () => {
  const course = { name: "软件工程" }, point = { id: "kp-tradeoff", title: "架构权衡", evidence: [{ quote: "架构选择需要同时考虑质量属性" }] };
  const unit = {
    id: "weak-case", title: "架构决策", course: "软件工程", keyPoints: [point],
    lesson: {
      flow: [{ phase: "案例研讨", minutes: 20, teacherAction: "展示项目材料并组织讨论", studentAction: "标出证据并比较方案", studentOutput: "提交带依据的选择结论", feedback: "对照约束条件检查并追问权衡依据" }],
      questions: [{ prompt: "如果用户规模扩大，应如何调整方案？", answerCue: "根据新的质量属性约束重新权衡", misconception: "认为一种架构适用于所有规模", keyPointIds: ["kp-tradeoff"] }],
    },
    resources: [{ type: "case", title: "架构讨论", purpose: "比较不同方案的适用边界", details: { context: "一个项目", scenario: "团队讨论架构。", questions: ["谈谈看法"], teachingNotes: "自由讨论" } }],
  };
  const [item] = buildPreparationQueue(course, [unit]);
  assert.equal(item.kind, "resources");
  assert.equal(item.label, "完善教学案例");
  assert.match(item.description, /1 项案例/);
  assert.equal(summarizeCourse(course, [unit]).gaps.resources, 1);
});

test("course preparation queue requires structurally complete resources to name their knowledge purpose", () => {
  const course = { name: "程序设计" }, point = { id: "kp-swap", title: "变量交换", evidence: [{ quote: "临时变量保存被覆盖前的旧值" }] };
  const unit = {
    id: "unlinked-resource", title: "变量交换", course: "程序设计", keyPoints: [point],
    lesson: {
      flow: [{ phase: "追踪", minutes: 20, teacherAction: "展示代码并逐行推进", studentAction: "记录每行后的变量状态", studentOutput: "提交完整变量状态表", feedback: "对照正确状态检查并纠正覆盖位置" }],
      questions: [{ prompt: "如果删除临时变量，交换结果会如何改变？", answerCue: "第一个赋值覆盖旧值，后续无法恢复", misconception: "认为赋值不会改变后续读取", keyPointIds: ["kp-swap"] }],
    },
    resources: [{ type: "code", title: "交换演示", purpose: "观察赋值顺序与状态覆盖", details: { language: "Python 3", code: "temp=a\na=b\nb=temp", sampleInput: "a=1,b=2", walkthrough: "观察初始变量状态并追踪每次赋值后的结果变化。" } }],
  };
  const [item] = buildPreparationQueue(course, [unit]);
  assert.equal(item.kind, "resources");
  assert.equal(item.label, "关联教学资源");
  assert.match(item.description, /1 项代码、实验或案例/);
  unit.resources[0].keyPointIds = ["kp-swap"];
  assert.notEqual(buildPreparationQueue(course, [unit])[0]?.label, "关联教学资源");
});

test("scheduled course units move urgent preparation ahead without losing teaching order ties", () => {
  const course = { name: "操作系统", unitOrder: ["later", "urgent", "week", "undated"] };
  const draft = id => ({ id, title: id, course: "操作系统", keyPoints: [], lesson: { flow: [], questions: [] } });
  const units = [
    { ...draft("later"), scheduledDate: "2026-09-20" },
    { ...draft("urgent"), scheduledDate: "2026-09-06" },
    { ...draft("week"), teachingWeek: 4 },
    draft("undated"),
  ];
  const queue = buildPreparationQueue(course, units, { today: new Date(2026, 8, 4) });
  assert.deepEqual(queue.map(item => item.unitId), ["urgent", "later", "week", "undated"]);
  assert.equal(queue[0].scheduleLabel, "2 天后授课");
  assert.equal(queue[2].scheduleLabel, "第 4 周");
  assert.equal(queue[3].scheduleLabel, "未排课");
});

test("course queue surfaces incomplete, orphaned-activity, and unconfirmed teaching alignment", () => {
  const course = { name: "操作系统", unitOrder: ["broken", "orphan", "suggested"] };
  const base = id => ({ id, title: id, course: "操作系统", objectives: ["解释竞态条件"], keyPoints: [{ id: "kp-race", title: "竞态条件", logic: "结果依赖执行交错", evidence: [{ quote: "结果取决于执行交错" }], evidenceReview: { status: "verified" } }], lesson: { flow: [{ id: "flow-race", phase: "执行交错", teacherAction: "播放并拆解执行轨迹", studentAction: "解释竞态条件发生位置", studentOutput: "提交标出覆盖写入的轨迹图", feedback: "对照关键帧检查并追问错误位置", keyPointIds: ["kp-race"] }], questions: [{ id: "q-race", prompt: "竞态条件为什么会在这条执行轨迹中发生？", answerCue: "两个线程在写回前读取了同一旧值", misconception: "认为加一语句天然具有原子性", keyPointIds: ["kp-race"] }] }, resources: [{ type: "case", title: "竞态案例", purpose: "解释竞态条件", keyPointIds: ["kp-race"], details: { context: "计费服务在高并发下偶发少记请求，开发团队需要定位共享状态错误。", scenario: "两个线程分别执行相同的计数更新，但是读写交错会覆盖结果；如果扩大锁范围又会降低吞吐量，团队需要权衡正确性、性能和改动成本。", questions: ["从执行日志中可以指出哪些异常事实？", "两个线程为什么会丢失一次更新？", "如果要做最小修改，应该选择哪种锁边界并说明依据？"], teachingNotes: "先对照日志证据确认覆盖写入，再收束到竞态条件与临界区边界的原理。" } }] });
  const broken = base("broken"), entities = alignmentEntities(broken);
  broken.teachingAlignment = alignmentFromSelections(broken, [{ objectiveRef: objectiveRef(broken.objectives[0]), knowledgeRefs: [entities.knowledge[0].ref], activityRefs: [entities.activities[0].ref], questionRefs: [] }]);
  const orphan = base("orphan"), orphanEntities = alignmentEntities(orphan);
  orphan.lesson.flow.push({ id: "flow-transfer", phase: "迁移练习", teacherAction: "给出新的调度顺序并提问", studentAction: "独立画出新的执行轨迹", studentOutput: "提交带状态值的时间线", feedback: "对照关键帧检查并纠正边界", keyPointIds: ["kp-race"] });
  orphan.teachingAlignment = alignmentFromSelections(orphan, [{ objectiveRef: objectiveRef(orphan.objectives[0]), knowledgeRefs: [orphanEntities.knowledge[0].ref], activityRefs: [orphanEntities.activities[0].ref], questionRefs: [orphanEntities.questions[0].ref] }]);
  const queue = buildPreparationQueue(course, [broken, orphan, base("suggested")]);
  assert.deepEqual(queue.map(item => [item.unitId, item.kind, item.label]), [["broken", "alignment", "补齐教学对齐"], ["orphan", "alignment", "补齐教学对齐"], ["suggested", "alignment", "确认教学对齐"]]);
  assert.match(queue[0].description, /1 项学习目标/);
  assert.match(queue[1].description, /1 个课堂活动链/);
  assert.match(queue[2].description, /需要教师确认/);
});

test("unit duplication keeps reusable teaching content but removes class-specific and job state", () => {
  let next = 0;
  const source = {
    id: "u1", isDemo: false, title: "进程同步", course: "操作系统", status: "可授课", sourceJobId: "analysis-job", partial: true,
    resources: [{ id: "r1", type: "lab", details: { steps: ["运行"] } }],
    animations: [{ id: "m1", versions: [{ versionNumber: 1, revisionJobId: "paid-job" }] }],
    improvementActions: [{ id: "a1", text: "旧班级调整", status: "done" }],
    versionHistory: [{ id: "v1" }],
  };
  const copy = duplicateTeachingUnit(source, { title: "进程同步（2 班）", course: "操作系统", copyResources: true, copyAnimations: true }, () => `id${++next}`);
  assert.equal(copy.id, "unit-id1");
  assert.equal(copy.title, "进程同步（2 班）");
  assert.equal(copy.status, "草稿");
  assert.equal(copy.sourceJobId, undefined);
  assert.equal(copy.partial, false);
  assert.deepEqual(copy.improvementActions, []);
  assert.deepEqual(copy.versionHistory, []);
  assert.equal(copy.resources[0].id, "resource-id2-1");
  assert.equal(copy.animations[0].id, "motion-id3-1");
  assert.equal(copy.animations[0].versions[0].revisionJobId, "");
  copy.resources[0].details.steps.push("提交");
  assert.deepEqual(source.resources[0].details.steps, ["运行"]);
});

test("unit duplication can intentionally omit resources and animations", () => {
  const copy = duplicateTeachingUnit({ id: "u1", title: "原单元", resources: [{}], animations: [{}] }, { copyResources: false, copyAnimations: false }, () => "copy");
  assert.deepEqual(copy.resources, []);
  assert.deepEqual(copy.animations, []);
});

test("teaching readiness blocks false completion and separates optional warnings", () => {
  const incomplete = assessUnitReadiness({ title: "操作系统", overview: "尚未完善", objectives: [], keyPoints: [], lesson: {}, resources: [] });
  assert.equal(incomplete.ready, false);
  assert.ok(incomplete.score < 50);
  assert.equal(incomplete.blockers.find(item => item.id === "evidence")?.tab, "materials");
  const readyUnit = {
    title: "进程同步与竞态条件", duration: "90 分钟", overview: "通过可观察的执行交错解释共享状态为何出现丢失更新。",
    objectives: ["画出执行轨迹", "判断临界区边界"],
    keyPoints: [{ id: "kp-race", title: "竞态条件", explanation: "多个线程读取相同旧值后分别计算并覆盖写入。", evidence: [{ slideNumber: 2, quote: "结果取决于执行交错" }] }],
    lesson: { flow: [
      { id: "flow-1", phase: "观察", minutes: 30, teacherAction: "播放两种执行轨迹", studentAction: "预测共享变量结果", studentOutput: "提交变量值与判断理由", feedback: "统计答案并追问错误分支", keyPointIds: ["kp-race"] },
      { id: "flow-2", phase: "解释", minutes: 30, teacherAction: "拆解读取计算写回", studentAction: "标出竞争窗口位置", studentOutput: "提交带标记的执行轨迹", feedback: "对照关键帧检查并纠正边界", keyPointIds: ["kp-race"] },
      { id: "flow-3", phase: "迁移", minutes: 30, teacherAction: "给出新的调度顺序", studentAction: "独立判断并说明理由", studentOutput: "写出新轨迹的最终状态与理由", feedback: "抽取不同答案比较并即时讲评", keyPointIds: ["kp-race"] },
    ], questions: [{ id: "q-1", prompt: "两次加一为何可能只留下一个更新结果？", answerCue: "两个线程读取同一旧值", misconception: "认为加一语句天然具有原子性", keyPointIds: ["kp-race"] }], afterClass: [] },
    resources: [{ type: "code", title: "共享变量追踪器", purpose: "观察状态覆盖过程", status: "草稿", keyPointIds: ["kp-race"], details: { language: "Python 3", code: "x = 0\nx = x + 1", sampleInput: "初始状态 x=0", walkthrough: "观察初始共享变量状态，并追踪读取、计算和写回后的结果变化。" } }],
  };
  const readyEntities = alignmentEntities(readyUnit);
  readyUnit.teachingAlignment = readyUnit.objectives.map((objective, index) => ({ objectiveRef: objectiveRef(objective), knowledgeRefs: [readyEntities.knowledge[0].ref], activityRefs: index ? [readyEntities.activities[2].ref] : [readyEntities.activities[0].ref, readyEntities.activities[1].ref], questionRefs: [readyEntities.questions[0].ref] }));
  const ready = assessUnitReadiness(readyUnit);
  assert.equal(ready.ready, true);
  assert.equal(ready.blockers.length, 0);
  assert.ok(ready.warnings.some(item => item.id === "verified"));
  assert.equal(ready.warnings.find(item => item.id === "verified")?.tab, "materials");
  assert.ok(ready.warnings.some(item => item.id === "resource-status"));
  assert.ok(ready.score < 100);
  readyUnit.teachingAlignment = readyUnit.objectives.map(objective => ({ objectiveRef: objectiveRef(objective), knowledgeRefs: [readyEntities.knowledge[0].ref], activityRefs: [readyEntities.activities[0].ref], questionRefs: [readyEntities.questions[0].ref] }));
  const orphanActivity = assessUnitReadiness(readyUnit);
  assert.equal(orphanActivity.ready, false);
  assert.equal(orphanActivity.blockers.find(item => item.id === "activity-alignment")?.tab, "overview");
});

test("motion quality distinguishes structural blockers from frame-layout advice", () => {
  const weak = assessMotionQuality({ teachingQuestion: "机制是什么？", narration: "太短", scene: { phases: [{ label: "开始" }], svgMarkup: '<svg><rect x="10" y="10" width="100" height="80"/><line x1="20" y1="20" x2="50" y2="50" marker-end="url(#a)"/></svg>' } });
  assert.equal(weak.ready, false);
  assert.ok(!weak.blockers.some(item => item.id === "layout"));
  assert.ok(weak.blockers.some(item => item.id === "phases"));
  const strong = assessMotionQuality({
    teachingQuestion: "两个线程为何只留下一个更新？", narration: "两个线程读取同一个旧值，各自计算后依次写回，后写入覆盖前写入。",
    evidence: [{ quote: "结果取决于执行交错" }],
    scene: { renderer: "ai-svg", bindings: [{ claim: "初值" }, { claim: "线程A" }, { claim: "线程B" }, { claim: "覆盖" }], phases: [{ label: "初值" }, { label: "读取" }, { label: "计算" }, { label: "写回" }], svgMarkup: '<svg><text x="10" y="10">x=0</text><g data-phase-index="0"><animate attributeName="opacity"/></g><g data-phase-index="1"><animateTransform attributeName="transform"/></g><g data-phase-index="2"></g></svg>' },
  });
  assert.equal(strong.ready, true);
  assert.equal(strong.blockers.length, 0);
  assert.ok(strong.score >= 85);
});

test("motion quality turns detected risks into an editable model instruction", () => {
  const instruction = buildMotionRevisionInstruction({
    blockers: [{ id: "layout", label: "箭头碰撞" }, { id: "phases", label: "阶段不足" }],
    warnings: [{ id: "density", label: "文字过多" }],
  });
  assert.match(instruction, /边界外 12–20 像素/);
  assert.match(instruction, /至少四个可跟随阶段/);
  assert.match(instruction, /删减画面文字/);
  assert.match(instruction, /保持知识事实、观看问题和正确结论不变/);
});

test("motion version status distinguishes automatic, revision, and teacher-approved states", () => {
  const base = {
    teachingQuestion: "两个线程为何只留下一个更新？",
    narration: "两个线程读取同一个旧值，各自计算后依次写回，后写入覆盖前写入。",
    evidence: [{ quote: "结果取决于执行交错" }],
    scene: { renderer: "ai-svg", bindings: [{ claim: "初值" }, { claim: "线程A" }, { claim: "线程B" }], phases: [{ label: "初值" }, { label: "读取" }, { label: "写回" }], svgMarkup: '<svg><g data-phase-index="0"></g><g data-phase-index="1"></g><g data-phase-index="2"></g></svg>' },
  };
  assert.equal(getMotionQualityState(base).id, "auto-pass");
  assert.equal(getMotionQualityState({ ...base, qualityReview: { status: "needs-revision" } }).id, "needs-revision");
  assert.equal(getMotionQualityState({ ...base, runtimeCheck:{passed:true,warnings:[]}, qualityReview: { status: "approved" } }).id, "approved");
  assert.equal(getMotionQualityState({ scene: {} }).id, "needs-revision");
});

test("teaching insight CSV accepts Chinese headers and quoted classroom evidence", () => {
  const rows = parseInsightCsv('教学单元,证据类型,观察证据,主要问题,下次调整\n进程同步,课堂测验,"18/32 人把 x=x+1, 误认为原子操作",忽略读改写交错,增加单步写回对比');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].unitTitle, "进程同步");
  assert.equal(rows[0].type, "课堂测验");
  assert.match(rows[0].evidence, /x=x\+1, 误认/);
  assert.equal(rows[0].adjustment, "增加单步写回对比");
});

test("analysis jobs and checkpoints survive a store restart", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "zhigou-job-store-"));
  try {
    const firstStore = new AnalysisJobStore({ directory });
    await firstStore.init();
    const job = {
      id: "11111111-1111-4111-8111-111111111111",
      state: "completed",
      createdAt: new Date().toISOString(),
      events: [],
      partialResult: { checkpoint: "knowledge", analysis: { keyPoints: [{ id: "kp-1", title: "并发条件" }] } },
      result: { analysis: { title: "并发程序设计" } },
    };
    await firstStore.save(job);

    const secondStore = new AnalysisJobStore({ directory });
    const restored = await secondStore.init();
    assert.equal(restored.length, 1);
    assert.equal(restored[0].state, "completed");
    assert.equal(restored[0].partialResult.checkpoint, "knowledge");
    assert.equal(restored[0].partialResult.analysis.keyPoints[0].title, "并发条件");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("a running job becomes recoverable interruption after service restart", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "zhigou-job-interruption-"));
  try {
    const firstStore = new AnalysisJobStore({ directory });
    await firstStore.init();
    await firstStore.save({
      id: "22222222-2222-4222-8222-222222222222",
      state: "running",
      createdAt: new Date().toISOString(),
      progress: { phase: "knowledge", title: "分析知识点" },
      events: [],
      partialResult: { checkpoint: "outline", analysis: { sections: [{ title: "线程同步" }] } },
    });

    const restored = await new AnalysisJobStore({ directory }).init();
    assert.equal(restored[0].state, "failed");
    assert.equal(restored[0].error.code, "ANALYSIS_INTERRUPTED");
    assert.equal(restored[0].error.status, 503);
    assert.equal(restored[0].partialResult.analysis.sections[0].title, "线程同步");
    assert.equal(restored[0].progress.phase, "interrupted");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("motion revision jobs stop safely after restart without replaying a paid request", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "zhigou-motion-interruption-"));
  const interruption = {
    code: "MOTION_REVISION_INTERRUPTED",
    title: "动效修改因服务重启而中断",
    detail: "不会自动重放付费请求。",
    message: "本次修改已安全停止。",
    recovery: "由教师手动重试。",
  };
  try {
    const store = new AnalysisJobStore({ directory, interruption });
    await store.init();
    await store.save({ id: "44444444-4444-4444-8444-444444444444", state: "running", createdAt: new Date().toISOString(), events: [] });
    const [restored] = await new AnalysisJobStore({ directory, interruption }).init();
    assert.equal(restored.state, "failed");
    assert.equal(restored.error.code, "MOTION_REVISION_INTERRUPTED");
    assert.equal(restored.error.recovery, "由教师手动重试。");
    assert.equal(restored.progress.title, "动效修改因服务重启而中断");
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("expired analysis jobs are removed during recovery", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "zhigou-job-expiry-"));
  try {
    const store = new AnalysisJobStore({ directory, retentionMs: 1000 });
    await store.init();
    await store.save({ id: "33333333-3333-4333-8333-333333333333", state: "completed", createdAt: "2020-01-01T00:00:00.000Z", events: [] });
    const file = path.join(directory, "33333333-3333-4333-8333-333333333333.json");
    const saved = JSON.parse(await fs.readFile(file, "utf8"));
    saved.updatedAt = "2020-01-01T00:00:00.000Z";
    await fs.writeFile(file, JSON.stringify(saved));
    assert.deepEqual(await store.init(), []);
    await assert.rejects(fs.access(file));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("rejects a legal but shallow SVG teaching explanation", () => {
  const scene = buildFreeformScene({
    title: "过于简单的动效",
    teachingQuestion: "机制是什么？",
    phases: [{ label: "开始", at: 0 }],
    bindings: [
      { svgId: "a", claim: "条件", role: "条件" },
      { svgId: "b", claim: "变化", role: "变化" },
      { svgId: "c", claim: "结果", role: "结果" },
    ],
    svgMarkup: '<svg viewBox="0 0 1120 560" xmlns="http://www.w3.org/2000/svg"><circle id="a" cx="100" cy="100" r="20"/><circle id="b" cx="300" cy="100" r="20"/><circle id="c" cx="500" cy="100" r="20"/></svg>',
  });
  assert.ok(scene);
  assert.deepEqual(freeformSceneQualityIssues(scene), [
    "可见事实绑定少于 4 项",
    "解释阶段少于 4 个",
    "缺少可验证的观看问题",
    "有意义的动态变化少于 2 处",
    "画面缺少可跟随的阶段标记",
  ]);
});

test("does not judge rendered layout or teaching quality from shape counts", () => {
  const scene = buildFreeformScene({
    title: "碰撞框图", teachingQuestion: "路径如何变化？", teachingCheck: "学生能否指出发生变化的位置？",
    phases: [{ label: "条件", at: 0 }, { label: "触发", at: 0.25 }, { label: "变化", at: 0.5 }, { label: "结果", at: 0.8 }],
    bindings: ["a", "b", "c", "d"].map((svgId) => ({ svgId, claim: `${svgId} 的可见事实`, role: "变化" })),
    svgMarkup: '<svg viewBox="0 0 1120 560" xmlns="http://www.w3.org/2000/svg"><style>@keyframes p{50%{opacity:.5}}.p{animation:p 2s infinite}</style><rect x="80" y="80" width="180" height="100" fill="#ff9800"/><text id="a" x="150" y="130" fill="#ff9900" data-phase-index="0">节点A</text><rect x="430" y="80" width="180" height="100" fill="#ddd"/><text id="b" x="500" y="130" data-phase-index="1">节点B</text><rect x="80" y="350" width="180" height="100"/><text id="c" x="150" y="400" data-phase-index="2">节点C</text><rect x="430" y="350" width="180" height="100"/><text id="d" x="500" y="400" data-phase-index="3">节点D</text><line class="p" x1="150" y1="130" x2="500" y2="130" marker-end="url(#arr)"/><line x1="500" y1="130" x2="150" y2="400" marker-end="url(#arr)"><animate attributeName="opacity" values="1;.5;1" dur="2s" repeatCount="indefinite"/></line><line x1="150" y1="400" x2="500" y2="400" marker-end="url(#arr)"/></svg>',
  });
  const issues = freeformSceneQualityIssues(scene);
  assert.ok(!issues.some(x=>x.includes("端点进入")));
  assert.ok(!issues.some(x=>x.includes("方框加箭头")));
  assert.ok(!issues.some(x=>x.includes("对比度")));
});

test("parses the deadlock sample and produces animation candidates", async (t) => {
  try {
    await fs.access(samplePath);
  } catch {
    t.skip("sample PPTX is not available");
    return;
  }

  const deck = await parsePptx(await fs.readFile(samplePath), samplePath.split("/").pop());
  assert.ok(deck.slideCount > 10);
  assert.ok(deck.slides.some((slide) => slide.text.includes("死锁")));

  const analysis = await analyzeDeck(deck, {
    useLlm: false,
    analysisRequest: "面向本科生，突出死锁必要条件和解决方法",
  });
  assert.ok(analysis.keyPoints.length >= 5);
  assert.ok(analysis.animations.length >= 2);
  assert.ok(analysis.animations.every((item) => item.items.length >= 2));
  assert.match(analysis.animations[0].title, /必要条件/);
  assert.equal(analysis.animations[0].scene.renderer, "svg");
  assert.equal(analysis.animations[0].scene.version, 3);
  assert.ok(analysis.animations[0].scene.nodes.length >= 2);
});

test("models communication mechanisms instead of flattening them into a flow", async (t) => {
  const processDeckPath = process.env.TEST_PROCESS_PPTX_PATH || "test/fixtures/optional-process.pptx";
  try {
    await fs.access(processDeckPath);
  } catch {
    t.skip("process communication PPTX is not available");
    return;
  }

  const deck = await parsePptx(await fs.readFile(processDeckPath), processDeckPath.split("/").pop());
  const analysis = await analyzeDeck(deck, { useLlm: false });
  const communication = analysis.animations.find((motion) => /进程通信的类型/.test(motion.title));
  assert.ok(communication);
  assert.equal(communication.scene.visualType, "mechanism");
  assert.deepEqual(
    new Set(communication.scene.modes.map((mode) => mode.kind)),
    new Set(["direct", "buffer", "remote"]),
  );
  assert.equal(communication.scene.defaultMode, "mode-buffer");
  assert.equal(communication.scene.phases.at(-1).action, "receive");
});

test("builds a different SVG scene from different PPT content", async () => {
  const deck = {
    filename: "photosynthesis.pptx",
    title: "光合作用",
    slideCount: 3,
    slides: [
      {
        number: 1,
        title: "光合作用的定义",
        paragraphs: [
          { text: "绿色植物利用光能，将二氧化碳和水合成有机物并释放氧气。", bullet: false },
          { text: "叶绿体是光合作用的主要场所。", bullet: true },
        ],
        tableRows: [], notes: "", media: { images: 1, charts: 0, tables: 0, diagrams: 0 },
        text: "光合作用的定义\n绿色植物利用光能，将二氧化碳和水合成有机物并释放氧气。\n叶绿体是光合作用的主要场所。",
      },
      {
        number: 2,
        title: "光合作用的过程",
        paragraphs: [
          { text: "1．光反应", bullet: true },
          { text: "叶绿素吸收光能并产生 ATP 和还原力，同时释放氧气。", bullet: false },
          { text: "2．碳反应", bullet: true },
          { text: "利用 ATP 和还原力固定二氧化碳，进一步合成糖类。", bullet: false },
        ],
        tableRows: [], notes: "", media: { images: 0, charts: 0, tables: 0, diagrams: 1 },
        text: "光合作用的过程\n1．光反应\n叶绿素吸收光能并产生 ATP 和还原力，同时释放氧气。\n2．碳反应\n利用 ATP 和还原力固定二氧化碳，进一步合成糖类。",
      },
      {
        number: 3,
        title: "影响光合作用的因素",
        paragraphs: [
          { text: "光照强度会影响光反应速率。", bullet: true },
          { text: "二氧化碳浓度会影响碳固定速率。", bullet: true },
          { text: "温度通过酶活性影响整体反应。", bullet: true },
        ],
        tableRows: [], notes: "", media: { images: 0, charts: 1, tables: 0, diagrams: 0 },
        text: "影响光合作用的因素\n光照强度会影响光反应速率。\n二氧化碳浓度会影响碳固定速率。\n温度通过酶活性影响整体反应。",
      },
    ],
  };

  const analysis = await analyzeDeck(deck, { useLlm: false, analysisRequest: "突出光合作用过程" });
  assert.match(analysis.title, /光合作用/);
  assert.ok(analysis.animations.length >= 2);
  assert.ok(analysis.animations.every((motion) => motion.scene.renderer === "svg"));
  const sceneText = JSON.stringify(analysis.animations.map((motion) => motion.scene));
  assert.match(sceneText, /光反应|碳反应|光照强度/);
  assert.doesNotMatch(sceneText, /死锁/);
});

test("semantic scene grammar composes from arbitrary content rather than a lesson template", () => {
  const stateScene = buildScene({
    title: "设备状态转换",
    type: "flow",
    slideNumber: 1,
    items: ["待机状态", "运行状态", "故障状态", "状态恢复"],
  });
  const hierarchyScene = buildScene({
    title: "材料的组成结构",
    type: "hierarchy",
    slideNumber: 2,
    items: ["基体", "增强相", "界面层", "孔隙"],
  });
  const categorizedScene = buildScene({
    title: "四类评价方法",
    type: "reveal",
    slideNumber: 3,
    items: ["形成性评价", "总结性评价", "诊断性评价", "表现性评价", "根据学习状态选择方法"],
  });
  assert.equal(stateScene.visualType, "state");
  assert.equal(hierarchyScene.visualType, "hierarchy");
  assert.equal(categorizedScene.visualType, "hierarchy");
  assert.match(JSON.stringify(stateScene), /待机状态|故障状态/);
  assert.doesNotMatch(JSON.stringify(stateScene), /基体|增强相/);
  assert.match(JSON.stringify(hierarchyScene), /基体|增强相/);
  const exportedSvg = standaloneSvg(stateScene);
  assert.match(exportedSvg, /<animateMotion/);
  assert.match(exportedSvg, /<style>/);
});

test("cause scenes require explicit evidence and keep canvas labels short", () => {
  const scene = buildScene({
    title: "影响链",
    type: "cause",
    slideNumber: 1,
    items: [
      "输入质量下降会导致识别误差增加。",
      "识别误差增加会导致后续判断不稳定。",
      "这一页还有一段没有方向关系的背景说明。",
    ],
  });
  assert.equal(scene.visualType, "cause");
  assert.equal(scene.relations.length, 2);
  assert.ok(scene.relations.every((relation) => relation.evidence.includes("导致")));
  assert.ok(scene.nodes.every((node) => node.label.length <= 8));
});

test("does not invent comparison groups when the deck provides no two subjects", () => {
  const scene = buildScene({
    title: "方法特点",
    type: "comparison",
    slideNumber: 1,
    items: ["响应速度较快。", "实现成本较低。", "适用范围较广。"],
  });
  assert.notEqual(scene.visualType, "comparison");
  assert.doesNotMatch(JSON.stringify(scene), /对象 A|对象 B/);
});

test("maps numeric position sequences to a trajectory instead of text cards", () => {
  const scene = buildScene({
    title: "访问位置轨迹",
    type: "trajectory",
    slideNumber: 1,
    items: ["访问顺序为 42、18、73、55、90。"],
  });
  assert.equal(scene.visualType, "trajectory");
  assert.deepEqual(scene.values, [42, 18, 73, 55, 90]);
  assert.match(standaloneSvg(scene), /trajectory-path/);
});

test("upload limit is consistent across the local client and server", async () => {
  const appSource = await fs.readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const serverSource = await fs.readFile(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(appSource, /DEFAULT_MAX_PPTX_SIZE_MB = 50/);
  assert.match(serverSource, /MAX_PPTX_SIZE_MB \|\| 50/);
  assert.match(appSource, /errorDialog/);
});

test("turns an outline or a single concept into analyzable source material", () => {
  const deck = textSourceToDeck({ title: "进程同步", mode: "concept", content: "临界区互斥\n多个进程不能同时修改共享变量。\n\n信号量\n用于协调访问顺序。" });
  assert.equal(deck.sourceMode, "concept");
  assert.equal(deck.slideCount, 2);
  assert.match(deck.slides[0].text, /临界区互斥/);
});

test("formal analysis refuses to disguise an unconfigured model as AI output", async () => {
  const deck = {
    filename: "lesson.pptx",
    title: "课程",
    slideCount: 1,
    slides: [{ number: 1, title: "主题", paragraphs: [{ text: "这是可核验的课程原文。", bullet: false }], tableRows: [], notes: "", media: {}, text: "主题\n这是可核验的课程原文。" }],
  };
  await assert.rejects(
    analyzeDeck(deck, { useLlm: true, llmClient: { configured: false } }),
    (error) => error.code === "MODEL_NOT_CONFIGURED" && /不会使用规则模板/.test(error.message),
  );
});

test("model workflow generates an outline, analyzes each knowledge point, and only then builds motion", async () => {
  const deck = {
    filename: "dynamic-lesson.pptx",
    title: "现象研究",
    slideCount: 2,
    slides: [
      {
        number: 1,
        title: "实验观察",
        paragraphs: [{ text: "温度升高会导致分子运动加快。", bullet: false }],
        tableRows: [], notes: "", media: {}, text: "实验观察\n温度升高会导致分子运动加快。",
      },
      {
        number: 2,
        title: "适用边界",
        paragraphs: [{ text: "结论只适用于给定的实验条件。", bullet: false }],
        tableRows: [], notes: "", media: {}, text: "适用边界\n结论只适用于给定的实验条件。",
      },
    ],
  };
  const stages = [];
  const fakeClient = {
    configured: true,
    model: "test-model",
    async completeJson({ stage, prompt }) {
      stages.push(stage);
      if (stage.startsWith("课件证据分块")) {
        return { units: [
          { draftTitle: "变化机制", summary: "观察变量之间的方向关系", concepts: ["温度", "分子运动"], logic: ["温度变化影响运动"], slideNumbers: [1], evidence: [{ slideNumber: 1, quote: "温度升高会导致分子运动加快。" }] },
          { draftTitle: "结论边界", summary: "识别结论的适用条件", concepts: ["实验条件"], logic: [], slideNumbers: [2], evidence: [{ slideNumber: 2, quote: "结论只适用于给定的实验条件。" }] },
        ] };
      }
      if (stage === "生成全局教学大纲") {
        return {
          title: "从现象到边界",
          overview: "先理解变化机制，再判断结论边界。",
          outline: [
            { title: "建立变化解释", summary: "识别变量的作用方向", slideNumbers: [1], evidence: [{ slideNumber: 1, quote: "温度升高会导致分子运动加快。" }] },
            { title: "限定结论范围", summary: "明确解释的适用范围", slideNumbers: [2], evidence: [{ slideNumber: 2, quote: "结论只适用于给定的实验条件。" }] },
          ],
          keyPoints: [
            { title: "温度与分子运动的方向关系", visualLabel: "温度作用", explanation: "温度升高推动分子运动加快。", teachingGoal: "看懂变量作用方向", difficulty: "不要把相关误解为无方向关系", importance: "high", slideNumbers: [1], evidence: [{ slideNumber: 1, quote: "温度升高会导致分子运动加快。" }] },
            { title: "实验结论的适用边界", visualLabel: "适用边界", explanation: "结论受给定实验条件限制。", teachingGoal: "能判断结论适用范围", difficulty: "避免过度外推", importance: "medium", slideNumbers: [2], evidence: [{ slideNumber: 2, quote: "结论只适用于给定的实验条件。" }] },
          ],
        };
      }
      if (stage.startsWith("逐知识点分析") && prompt.includes("温度与分子运动")) {
        return {
          coreLogic: "输入变量温度的上升沿着明确方向改变分子运动。",
          teachingQuestion: "温度升高如何影响分子运动？",
          misconception: "把有方向的作用看成并列现象。",
          visualDecision: { shouldAnimate: true, reason: "运动可直接呈现作用由原因向结果传导。", priority: 1 },
        };
      }
      if (stage.startsWith("逐知识点分析")) {
        return {
          coreLogic: "解释必须受原始实验条件约束。",
          teachingQuestion: "这个结论适用于哪里？",
          misconception: "把局部结论推广到所有条件。",
          visualDecision: { shouldAnimate: false, reason: "静态边界标注比运动更清楚。", priority: 4 },
          animation: null,
        };
      }
      if (stage === "跨知识点一致性校验") {
        return { overview: "先解释变量变化，再明确结论边界。", orderedKeyPointIds: ["kp-1", "kp-2"], selectedAnimationIds: ["kp-1"], coherenceNote: "只保留能揭示方向变化的动效。" };
      }
      if (stage === "生成章节教学设计") {
        return { title: "变量变化与结论边界", objectives: ["解释温度对分子运动的影响", "判断结论的适用条件", "区分因果关系与并列现象"], flow: [{ phase: "预测", minutes: 10, teacherAction: "展示温度变化", studentAction: "预测运动变化", studentOutput: "提交方向预测和一条理由", feedback: "统计预测分布并追问错误方向", keyPointIds: ["kp-1"] }, { phase: "边界辨析", minutes: 10, teacherAction: "追问适用条件", studentAction: "说明结论边界", studentOutput: "写出适用与不适用条件", feedback: "对照材料原句核对并纠正外推", keyPointIds: ["kp-2"] }], questions: [{ question: "较弱的旧问题", purpose: "不应优先" }], assessment: [{ prompt: "温度升高后什么发生改变？", answerCue: "分子运动加快", misconception: "把方向关系看成并列", keyPointIds: ["kp-1"] }] };
      }
      if (stage.startsWith("动效视觉蓝图")) {
        return {
          title: "温度与运动", teachingQuestion: "温度升高如何影响分子运动？", teachingCheck: "学生能否根据轨迹变化判断运动速度？", visualMetaphor: "粒子密度与速度的聚散", representationStrategy: "用同一时间窗口内的粒子位移直接表现速度变化，而不是画因果框图。", layoutSafety: "热源、粒子轨迹与对照尺分区放置，彼此保持至少 24 像素净空。", designRationale: "热量脉冲使粒子轨迹逐渐加速。", durationMs: 9000,
          phases: [{ label: "初态", at: 0 }, { label: "加热", at: 0.25 }, { label: "加速", at: 0.55 }, { label: "对照", at: 0.82 }],
          logicSteps: [{ claim: "温度升高", visibleEvidence: "热量输入" }, { claim: "粒子获得更快运动", visibleEvidence: "轨迹变长" }, { claim: "运动速度加快", visibleEvidence: "单位时间位移增大" }],
          motionSequence: [{ at: 0, action: "显示初态", visibleChange: "轨迹较短" }, { at: 0.3, action: "输入热量", visibleChange: "轨迹拉长" }, { at: 0.65, action: "对照速度", visibleChange: "单位时间位移增大" }],
          bindings: [{ svgId: "heat", claim: "温度升高是输入变量", role: "条件" }, { svgId: "particles", claim: "分子运动随温度变化", role: "中间机制" }, { svgId: "outcome", claim: "运动速度加快是结果", role: "结果" }, { svgId: "contrast", claim: "未加热时轨迹较短", role: "反证" }],
          objects: [{ id: "heat", label: "温度" }, { id: "particles", label: "分子" }, { id: "outcome", label: "加快" }],
          misconceptionCorrection: { wrongView: "只是颜色变化", counterEvidence: "对照单位时间位移" },
        };
      }
      if (stage.startsWith("SVG 动效渲染")) return { svgMarkup: '<svg viewBox="0 0 1120 560" xmlns="http://www.w3.org/2000/svg"><style>@keyframes pulse{50%{r:34}}.p{animation:pulse 2s infinite}</style><rect width="1120" height="560" fill="#f8fafc"/><g id="heat" data-phase-index="0"><circle class="p" cx="300" cy="280" r="20" fill="#7659f6"/></g><g id="particles" data-phase-index="1"><circle cx="700" cy="200" r="16" fill="#20bce7"><animate attributeName="cx" values="650;770;650" dur="2s" repeatCount="indefinite"/></circle></g><text id="outcome" data-phase-index="2" x="560" y="500">温度作用</text><path id="contrast" data-phase-index="3" d="M100 450H300" stroke="#333"><animate attributeName="stroke-dashoffset" values="20;0" dur="2s" repeatCount="indefinite"/></path></svg>' };
      throw new Error(`unexpected stage: ${stage}`);
    },
  };

  const checkpoints = [];
  const analysis = await analyzeDeck(deck, { useLlm: true, llmClient: fakeClient, onCheckpoint(checkpoint) { checkpoints.push(checkpoint); } });
  assert.equal(analysis.engine, "llm-knowledge-workflow");
  assert.deepEqual(analysis.sections.map((section) => section.title), ["建立变化解释", "限定结论范围"]);
  assert.equal(analysis.keyPoints.length, 2);
  assert.equal(analysis.lessonPlan.flow.length, 2);
  assert.equal(analysis.lessonPlan.flow[0].studentOutput, "提交方向预测和一条理由");
  assert.match(analysis.lessonPlan.flow[0].feedback, /追问错误方向/);
  assert.equal(analysis.lessonPlan.questions[0].prompt, "温度升高后什么发生改变？");
  assert.equal(analysis.lessonPlan.questions[0].answerCue, "分子运动加快");
  assert.deepEqual(analysis.lessonPlan.questions[0].keyPointIds, ["kp-1"]);
  assert.match(analysis.keyPoints[0].coreLogic, /明确方向/);
  assert.equal(analysis.animations.length, 1);
  assert.equal(analysis.animations[0].id, "anim-1");
  assert.equal(analysis.animations[0].scene.renderer, "ai-svg");
  assert.match(analysis.animations[0].scene.svgMarkup, /animate/);
  assert.ok(stages.some((stage) => stage === "生成全局教学大纲"));
  assert.equal(stages.filter((stage) => stage.startsWith("逐知识点分析")).length, 2);
  assert.ok(stages.includes("跨知识点一致性校验"));
  assert.ok(stages.some((stage) => stage.startsWith("动效视觉蓝图")));
  assert.ok(stages.some((stage) => stage.startsWith("SVG 动效渲染")));
  assert.deepEqual(checkpoints.map((checkpoint) => checkpoint.stage), ["outline", "knowledge", "lesson", "motion"]);
  assert.equal(checkpoints[2].analysis.lessonPlan.flow.length, 2);
  assert.equal(checkpoints[3].analysis.animations.length, 1);
});

test("model client retries a throttled request and preserves provider diagnostics", async () => {
  let calls = 0;
  const client = createLlmClient({
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", apiKey: "test", model: "test-model",
    maxAttempts: 2, retryBaseDelayMs: 1,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return new Response(JSON.stringify({ code: "Throttling.RateQuota", message: "slow down", request_id: "req-1" }), { status: 429, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.deepEqual(await client.completeJson({ stage: "测试重试", prompt: "test" }), { ok: true });
  assert.equal(calls, 2);
});

test("model client retries invalid JSON once instead of failing the whole workflow", async () => {
  let calls = 0;
  const client = createLlmClient({
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", apiKey: "test", model: "test-model",
    maxAttempts: 2, retryBaseDelayMs: 1,
    fetchImpl: async () => {
      calls += 1;
      const content = calls === 1 ? "not json" : '{"fixed":true}';
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.deepEqual(await client.completeJson({ stage: "测试 JSON 修复", prompt: "test" }), { fixed: true });
  assert.equal(calls, 2);
});

test("frontend maps model output into the generic teaching-unit workspace", async () => {
  const appSource = await fs.readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const indexSource = await fs.readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const runtimeSource = await fs.readFile(new URL("../public/scene-runtime.js", import.meta.url), "utf8");
  const plannerSource = await fs.readFile(new URL("../src/scene-builder.mjs", import.meta.url), "utf8");
  const workflowSource = await fs.readFile(new URL("../src/semantic-workflow.mjs", import.meta.url), "utf8");
  const editorSource = await fs.readFile(new URL("../public/unit-content-editor.js", import.meta.url), "utf8");
  const relationEditorSource = await fs.readFile(new URL("../public/knowledge-relations-editor.js", import.meta.url), "utf8");
  const evidenceSource = await fs.readFile(new URL("../public/source-evidence.js", import.meta.url), "utf8");
  const resourceDetailsSource = await fs.readFile(new URL("../public/resource-details.js", import.meta.url), "utf8");
  const alignmentSource = await fs.readFile(new URL("../public/teaching-alignment.js", import.meta.url), "utf8");
  const diagnosticQualitySource = await fs.readFile(new URL("../public/diagnostic-quality.js", import.meta.url), "utf8");
  const labQualitySource = await fs.readFile(new URL("../public/lab-quality.js", import.meta.url), "utf8");
  const caseQualitySource = await fs.readFile(new URL("../public/case-quality.js", import.meta.url), "utf8");
  const codeQualitySource = await fs.readFile(new URL("../public/code-quality.js", import.meta.url), "utf8");
  const resourceQualitySource = await fs.readFile(new URL("../public/resource-quality.js", import.meta.url), "utf8");
  const classroomTimelineSource = await fs.readFile(new URL("../public/classroom-timeline.js", import.meta.url), "utf8");
  assert.match(appSource, /function ingestResult/);
  assert.match(appSource, /a\.keyPoints/);
  assert.match(appSource, /a\.animations/);
  assert.match(appSource, /renderScene/);
  assert.match(appSource, /activeJobKey/);
  assert.match(appSource, /resumeActiveJob/);
  assert.match(appSource, /partialResult/);
  assert.doesNotMatch(appSource.match(/function ingestResult[\s\S]*?function motionSnapshot/)?.[0] || "", /demoUnit\.(?:objectives|keyPoints|lesson|resources)/);
  assert.match(plannerSource, /entities|relations|visualType/);
  assert.match(appSource, /const baseUnits=\[\]/);
  assert.match(appSource, /personal=units\.filter\(unit=>!unit\.isDemo\)/);
  assert.match(appSource, /const assetUnits=personal/);
  assert.match(appSource, /courseStoreKey="zhigou-courses-v1"/);
  assert.match(appSource, /function saveCourse\(\)/);
  assert.match(appSource, /state\.units\.filter\(unit=>!unit\.isDemo&&unit\.course===oldName\)/);
  assert.match(appSource, /syncCourseSelect\(name\)/);
  assert.match(appSource, /function saveUnitEditor\(\)/);
  assert.match(appSource, /function setupUnitDuplication\(\)/);
  assert.match(appSource, /function setupCourseBatch\(\)/);
  assert.match(appSource, /data-prepare-course-unit/);
  assert.match(appSource, /data-prepare-kind/);
  assert.match(appSource, /setupCourseUnitList/);
  assert.doesNotMatch(appSource, /function setupCourseSchedule\(\)/);
  assert.doesNotMatch(appSource, /data-course-date/);
  assert.match(evidenceSource, /id="saveEvidenceRows"/);
  assert.match(evidenceSource, /原核对状态已失效/);
  assert.match(evidenceSource, /data-source-context/);
  assert.match(evidenceSource, /已定位原句/);
  assert.match(appSource, /createMaterialLedger/);
  assert.match(appSource, /createCourseUnitSkeletons/);
  assert.match(appSource, /粘贴目录直接预览不调用模型/);
  assert.match(appSource, /course-batch-existing/);
  assert.doesNotMatch(appSource, /u\.completion\|\|20/);
  assert.match(appSource, /targetUnitId/);
  assert.match(appSource, /mergeAnalysisIntoExistingUnit/);
  assert.match(appSource, /补充材料到：/);
  assert.match(appSource, /后台分析已写回原教学单元/);
  assert.match(appSource, /const normalDraft=savedDraft\.targetUnitId\?\{\}:savedDraft/);
  assert.match(appSource, /normalCourse=normalDraft\.sourceCourse/);
  assert.match(appSource, /function setupAnalysisUpdateControls\(\)/);
  assert.match(appSource, /id="reanalyzeUnitButton"/);
  assert.match(appSource, /使用云端模型可能产生费用/);
  assert.match(appSource, /mergeOptions:active\.mergeOptions/);
  assert.match(appSource, /中间成果不会自动覆盖当前版本/);
  assert.match(appSource, /applyPendingAnalysisSelection/);
  assert.match(appSource, /应用所选内容/);
  assert.match(appSource, /未选择部分保持原版本/);
  assert.match(appSource, /data-pending-item-section/);
  assert.match(appSource, /data-pending-group/);
  assert.match(appSource, /item\.status==="added"/);
  assert.match(appSource, /const readyButton=\$\("#readyUnitButton"\)/);
  assert.doesNotMatch(appSource, /unit-header-actions \.button"\)\[1\]/);
  assert.match(appSource, /unitReturn:\{view:"units",course:""\}/);
  assert.match(appSource, /function recordUnitVersion\(unit,title,detail\)/);
  assert.match(appSource, /function renderVersionHistory\(unit\)/);
  assert.match(appSource, /function restoreUnitVersion\(versionId\)/);
  assert.match(appSource, /function confirmRestoreUnitVersion\(\)/);
  assert.match(appSource, /恢复前自动备份/);
  assert.doesNotMatch(appSource, /window\.confirm/);
  assert.match(indexSource, /id="restoreVersionDialog"/);
  assert.match(indexSource, /id="confirmRestoreVersion"/);
  assert.match(appSource, /recordUnitVersion\(unit,`修改动效/);
  assert.match(appSource, /activeMotionRevisionKey/);
  assert.match(appSource, /resumeActiveMotionRevision/);
  assert.match(appSource, /revisionJobId/);
  assert.match(editorSource, /编辑知识与难点/);
  assert.match(editorSource, /编辑课堂流程/);
  assert.match(editorSource, /编辑互动与评价/);
  assert.match(editorSource, /每个课堂环节都需要名称、时间、师生活动、学生可观察产出和教师形成性反馈/);
  assert.match(editorSource, /关联知识点（用于题组覆盖检查）/);
  assert.match(relationEditorSource, /校正知识关系/);
  assert.match(relationEditorSource, /不要因为知识点相邻/);
  assert.match(evidenceSource, /当前使用的原文证据/);
  assert.match(evidenceSource, /没有可核对的原文证据/);
  assert.match(evidenceSource, /标记已核对/);
  assert.match(resourceDetailsSource, /代码演示内容/);
  assert.match(resourceDetailsSource, /实验任务内容/);
  assert.match(resourceDetailsSource, /教学案例内容/);
  assert.match(appSource, /resourceDraftKey="zhigou-resource-drafts-v1"/);
  assert.match(appSource, /已恢复 .* 的本机草稿/);
  assert.match(appSource, /放弃恢复的草稿/);
  assert.match(appSource, /unitEditorDraftKey="zhigou-unit-editor-drafts-v1"/);
  assert.match(editorSource, /草稿已自动保存到本机/);
  assert.match(editorSource, /unitSectionFingerprint/);
  assert.match(appSource, /createTeachingAlignmentInspector/);
  assert.match(appSource, /teachingAlignment:Array\.isArray/);
  assert.match(appSource, /data-prepare-kind="alignment"/);
  assert.match(appSource, /教学对齐/);
  assert.match(alignmentSource, /课堂活动反向检查/);
  assert.match(alignmentSource, /未关联学习目标/);
  assert.match(alignmentSource, /缺少诊断闭环/);
  assert.match(appSource, /createDiagnosticQualityPanel/);
  assert.match(appSource, /data-prepare-kind="assessment-quality"/);
  assert.match(appSource, /assessment-set/);
  assert.match(appSource, /importance:k\.importance\|\|"medium"/);
  assert.match(diagnosticQualitySource, /诊断题质量检查/);
  assert.match(diagnosticQualitySource, /诊断题组覆盖检查/);
  assert.match(diagnosticQualitySource, /findDiagnosticDuplicates/);
  assert.match(diagnosticQualitySource, /importance !== "supporting"/);
  assert.match(appSource, /createResourceQualityPanel/);
  assert.match(appSource, /data-resource-index/);
  assert.match(labQualitySource, /实验任务质量检查/);
  assert.match(labQualitySource, /评分量规至少需要 2 个完整维度/);
  assert.match(caseQualitySource, /教学案例质量检查/);
  assert.match(caseQualitySource, /识别—解释—决策递进/);
  assert.match(codeQualitySource, /缺少输入、初始状态或运行前提/);
  assert.match(resourceQualitySource, /教学资源质量总览/);
  assert.match(resourceQualitySource, /assessResourceKnowledgeLinks/);
  assert.match(resourceQualitySource, /未关联任何有效知识点/);
  assert.match(resourceQualitySource, /系统只检查教学结构，不执行任何代码/);
  assert.match(appSource, /服务哪些知识点/);
  assert.match(appSource, /keyPointIds:readResourceKnowledgeLinks/);
  assert.match(appSource, /createClassroomTimeline/);
  assert.match(indexSource, /data-unit-tab="timeline"/);
  assert.match(classroomTimelineSource, /自动编排未安排内容/);
  assert.match(classroomTimelineSource, /data-timeline-item/);
  assert.match(classroomTimelineSource, /dragstart/);
  assert.match(workflowSource, /案例 scenario 必须呈现需要权衡的冲突或约束/);
  assert.match(workflowSource, /实验资源至少生成 3 个 steps/);
  assert.match(workflowSource, /代码资源必须说明语言或环境、真实代码、输入或初始状态/);
  assert.match(diagnosticQualitySource, /判断依据/);
  assert.doesNotMatch(appSource, /id:"graph"|id:"search"|id:"memory"/);
});
