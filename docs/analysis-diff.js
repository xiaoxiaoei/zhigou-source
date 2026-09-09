function normalized(value = "") {
  return String(value).trim().toLocaleLowerCase("zh-CN");
}

function comparable(value) {
  if (Array.isArray(value)) return value.map(comparable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/^(id|createdAt|updatedAt|sourceJobId|revisionJobId)$/.test(key)).map(([key, item]) => [key, comparable(item)]));
}

function listDiff(current = [], pending = [], labelFor = item => item?.title || "未命名条目", keyFor = labelFor) {
  const currentMap = new Map(current.map(item => [normalized(keyFor(item)), item]));
  const pendingMap = new Map(pending.map(item => [normalized(keyFor(item)), item]));
  const keys = [...new Set([...currentMap.keys(), ...pendingMap.keys()])].filter(Boolean);
  return keys.map(key => {
    const before = currentMap.get(key), after = pendingMap.get(key);
    const status = !before ? "added" : !after ? "missing" : JSON.stringify(comparable(before)) === JSON.stringify(comparable(after)) ? "unchanged" : "changed";
    return { key, label: labelFor(after || before), status };
  });
}

function section(id, label, current, pending, labelFor, keyFor = labelFor) {
  const items = listDiff(current, pending, labelFor, keyFor);
  return { id, label, currentCount: current.length, pendingCount: pending.length, changedCount: items.filter(item => item.status !== "unchanged").length, items };
}

export function summarizeAnalysisDiff(unit = {}) {
  const pending = unit.pendingAnalysis || {};
  const overviewItems = [
    { key: "overview", label: "核心问题说明", status: String(unit.overview || "") === String(pending.overview || "") ? "unchanged" : pending.overview ? "changed" : "missing" },
    { key: "objectives", label: "学习目标", status: JSON.stringify(comparable(unit.objectives || [])) === JSON.stringify(comparable(pending.objectives || [])) ? "unchanged" : (pending.objectives || []).length ? "changed" : "missing" },
  ];
  const lessonEntries = lesson => [
    ...(lesson?.flow || []).map(item => ({ ...item, _diffKind: "flow", _diffIdentity: item.phase || item.title || "未命名", _diffLabel: `课堂环节 · ${item.phase || item.title || "未命名"}` })),
    ...(lesson?.questions || []).map(item => ({ ...item, _diffKind: "question", _diffIdentity: item.prompt || item.question || "未命名", _diffLabel: `诊断问题 · ${item.prompt || item.question || "未命名"}` })),
    ...(lesson?.afterClass || []).map(item => ({ value: item, _diffKind: "afterClass", _diffIdentity: String(item).slice(0,30), _diffLabel: `课后证据 · ${String(item).slice(0,30)}` })),
  ];
  return [
    { id: "overview", label: "教学概览", currentCount: 2, pendingCount: [pending.overview, ...(pending.objectives || [])].filter(Boolean).length, changedCount: overviewItems.filter(item => item.status !== "unchanged").length, items: overviewItems },
    section("knowledge", "知识点与关系", unit.keyPoints || [], pending.keyPoints || [], item => item?.title || item?.visualLabel || "未命名知识点"),
    section("lesson", "课堂流程与评价", lessonEntries(unit.lesson), lessonEntries(pending.lesson), item => item?._diffLabel || "未命名课堂内容", item => `${item?._diffKind || "lesson"}::${item?._diffIdentity || "未命名"}`),
    section("resources", "教学资源", unit.resources || [], pending.resources || [], item => `${item?.type || "资源"} · ${item?.title || "未命名资源"}`),
    section("animations", "知识动效", unit.animations || [], pending.animations || [], item => item?.title || item?.teachingQuestion || "未命名动效"),
  ];
}

function mergeUnique(current = [], pending = [], identity) {
  const result = structuredClone(current || []), seen = new Set(result.map(identity));
  for (const item of pending || []) {
    const key = identity(item);
    if (!key || seen.has(key)) continue;
    seen.add(key); result.push(structuredClone(item));
  }
  return result;
}

function mergeSelected(current = [], pending = [], selectedKeys = [], labelFor) {
  const selected = new Set(selectedKeys || []), result = structuredClone(current || []), positions = new Map(result.map((item, index) => [normalized(labelFor(item)), index]));
  for (const item of pending || []) {
    const key = normalized(labelFor(item));
    if (!selected.has(key)) continue;
    if (positions.has(key)) result[positions.get(key)] = structuredClone(item);
    else { positions.set(key, result.length); result.push(structuredClone(item)); }
  }
  return result;
}

export function applyPendingAnalysisSelection(unit = {}, selection = {}) {
  const pending = unit.pendingAnalysis;
  if (!pending) return { unit, applied: [] };
  const next = structuredClone(unit), applied = [];
  if (selection.overview) { next.overview = pending.overview || next.overview; next.objectives = structuredClone(pending.objectives || []); applied.push("教学概览"); }
  if (selection.knowledge === true) { next.keyPoints = structuredClone(pending.keyPoints || []); next.knowledgeRelations = structuredClone(pending.knowledgeRelations || []); applied.push("知识点与关系"); }
  else if (Array.isArray(selection.knowledge) && selection.knowledge.length) {
    next.keyPoints = mergeSelected(next.keyPoints, pending.keyPoints, selection.knowledge, item => item?.title || item?.visualLabel || "未命名知识点");
    const pointRefs = new Set(next.keyPoints.flatMap(item => [item.id, item.title, item.visualLabel].filter(Boolean).map(normalized)));
    next.knowledgeRelations = mergeUnique(next.knowledgeRelations, pending.knowledgeRelations, item => `${normalized(item?.from)}::${normalized(item?.to)}::${normalized(item?.type)}`).filter(item => pointRefs.has(normalized(item.from)) && pointRefs.has(normalized(item.to)));
    applied.push(`知识点 ${selection.knowledge.length} 项`);
  }
  if (selection.lesson === true) { next.lesson = structuredClone(pending.lesson || { flow: [], questions: [], afterClass: [] }); applied.push("课堂流程与评价"); }
  else if (Array.isArray(selection.lesson) && selection.lesson.length) {
    const selected = new Set(selection.lesson), currentLesson = next.lesson || {}, pendingLesson = pending.lesson || {};
    next.lesson = {
      flow: mergeSelected(currentLesson.flow, pendingLesson.flow, [...selected].filter(key => key.startsWith("flow::")).map(key => key.slice(6)), item => item?.phase || item?.title || "未命名"),
      questions: mergeSelected(currentLesson.questions, pendingLesson.questions, [...selected].filter(key => key.startsWith("question::")).map(key => key.slice(10)), item => item?.prompt || item?.question || "未命名"),
      afterClass: mergeSelected(currentLesson.afterClass, pendingLesson.afterClass, [...selected].filter(key => key.startsWith("afterclass::")).map(key => key.slice(12)), item => String(item).slice(0,30)),
    };
    applied.push(`课堂内容 ${selection.lesson.length} 项`);
  }
  if (selection.resources) { next.resources = mergeUnique(next.resources, pending.resources, item => `${normalized(item?.type)}::${normalized(item?.title)}`); applied.push("教学资源"); }
  if (selection.animations) { next.animations = mergeUnique(next.animations, pending.animations, item => normalized(item?.title || item?.teachingQuestion || item?.id)); applied.push("知识动效"); }
  if (!applied.length) return { unit, applied };
  next.source = structuredClone(pending.source || next.source);
  next.sourceJobId = pending.sourceJobId || next.sourceJobId;
  next.pendingAnalysis = null;
  next.partial = false;
  next.status = "进行中";
  next.updated = "刚刚";
  return { unit: next, applied };
}
