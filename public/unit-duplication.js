function clone(value) {
  return value == null ? value : structuredClone(value);
}

export function duplicateTeachingUnit(source = {}, options = {}, idFactory = () => crypto.randomUUID()) {
  const copy = clone(source);
  const unitId = `unit-${idFactory()}`;
  copy.id = unitId;
  copy.isDemo = false;
  copy.title = String(options.title || `${source.title || "教学单元"}（副本）`).trim();
  copy.course = options.course || source.course || "暂不归入课程";
  copy.status = "草稿";
  copy.updated = "刚刚";
  copy.partial = false;
  copy.versionHistory = [];
  copy.improvementActions = [];
  copy.caseReviews = [];
  copy.caseRuns = [];
  copy.duplicatedFrom = { unitId: source.id || "", unitTitle: source.title || "", duplicatedAt: new Date().toISOString() };
  delete copy.sourceJobId;

  if (options.copyResources === false) copy.resources = [];
  else copy.resources = (copy.resources || []).map((resource, index) => ({ ...resource, id: `resource-${idFactory()}-${index + 1}` }));

  if (options.copyAnimations === false) copy.animations = [];
  else copy.animations = (copy.animations || []).map((motion, motionIndex) => {
    const motionId = `motion-${idFactory()}-${motionIndex + 1}`;
    const versions = (motion.versions || []).map((version, versionIndex) => ({
      ...version,
      versionId: `${motionId}-v${version.versionNumber || versionIndex + 1}`,
      revisionJobId: "",
    }));
    return { ...motion, id: motionId, versions };
  });
  return copy;
}
