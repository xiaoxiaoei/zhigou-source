function mergeUnique(existing = [], generated = [], identity) {
  const result = structuredClone(existing || []);
  const seen = new Set(result.map(identity));
  for (const item of generated || []) {
    const key = identity(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(structuredClone(item));
  }
  return result;
}

const resourceIdentity = item => `${String(item?.type || "resource").toLowerCase()}::${String(item?.title || "").trim().toLocaleLowerCase("zh-CN")}`;
const animationIdentity = item => String(item?.title || item?.teachingQuestion || item?.id || "").trim().toLocaleLowerCase("zh-CN");

export function mergeAnalysisIntoExistingUnit(existing = {}, generated = {}, { jobId = "", partial = false, reviewBeforeApply = false, keepResources = true, keepAnimations = true } = {}) {
  if (!existing?.id) return generated;
  const hasExistingContent = (existing.keyPoints || []).length || (existing.objectives||[]).length || (existing.lesson?.questions||[]).length || (existing.lesson?.flow || []).length || (existing.resources || []).length || (existing.animations || []).length;
  if ((partial || reviewBeforeApply) && hasExistingContent) {
    return {
      ...structuredClone(existing),
      status: "需复核",
      sourceJobId: jobId || generated.sourceJobId || "",
      pendingAnalysis: { ...structuredClone(generated), sourceJobId: jobId || generated.sourceJobId || "", savedAt: new Date().toISOString() },
      updated: "刚刚",
    };
  }
  return {
    ...generated,
    id: existing.id,
    isDemo: false,
    title: existing.title || generated.title,
    course: existing.course || generated.course,
    chapter: existing.chapter || generated.chapter,
    description: existing.description || '',
    outlineLevel: existing.outlineLevel,
    parentChapter: existing.parentChapter,
    materials: mergeUnique(existing.materials,generated.materials,item=>item.id),
    duration: existing.duration || generated.duration,
    status: partial ? "待继续" : "进行中",
    sourceJobId: jobId || generated.sourceJobId || "",
    resources: keepResources ? mergeUnique(existing.resources, generated.resources, resourceIdentity) : structuredClone(generated.resources || []),
    animations: keepAnimations ? mergeUnique(existing.animations, generated.animations, animationIdentity) : structuredClone(generated.animations || []),
    motionPlans: keepAnimations ? mergeUnique(existing.motionPlans, generated.motionPlans, item => item.knowledgePointId) : structuredClone(generated.motionPlans || []),
    improvementActions: Array.isArray(existing.improvementActions) ? structuredClone(existing.improvementActions) : [],
    versionHistory: Array.isArray(existing.versionHistory) ? structuredClone(existing.versionHistory) : [],
    batchCreatedAt: existing.batchCreatedAt,
    pendingAnalysis: null,
    updated: "刚刚",
  };
}

export function canAnalyzeIntoUnit(unit = {}) {
  return !unit.isDemo && unit.status === "待分析" && !(unit.keyPoints || []).length;
}
