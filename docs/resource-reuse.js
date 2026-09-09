function clone(value) {
  return value == null ? value : structuredClone(value);
}

export function assetIdentity(sourceUnit = {}, kind = "resource", index = 0) {
  const collection = kind === "motion" ? sourceUnit.animations : sourceUnit.resources;
  const item = collection?.[index];
  return `${sourceUnit.id || "unknown"}:${kind}:${item?.id || index}`;
}

export function reuseTeachingAsset({ sourceUnit, targetUnit, kind = "resource", index = 0, idFactory = () => crypto.randomUUID() } = {}) {
  if (!sourceUnit || !targetUnit || sourceUnit.id === targetUnit.id) return { added: false, reason: "invalid-target" };
  const identity = assetIdentity(sourceUnit, kind, index);
  const collectionName = kind === "motion" ? "animations" : "resources";
  const source = sourceUnit[collectionName]?.[index];
  if (!source) return { added: false, reason: "missing-source" };
  const targetCollection = Array.isArray(targetUnit[collectionName]) ? targetUnit[collectionName] : [];
  if (targetCollection.some(item => item?.reusedFrom?.assetIdentity === identity)) return { added: false, reason: "duplicate" };

  const copy = clone(source);
  const copyId = idFactory();
  copy.id = `${kind}-${copyId}`;
  copy.status = kind === "motion" ? copy.status : "待确认";
  copy.reusedFrom = {
    assetIdentity: identity,
    unitId: sourceUnit.id,
    unitTitle: sourceUnit.title || "来源教学单元",
    originalId: source.id || "",
    reusedAt: new Date().toISOString(),
  };
  if (kind === "motion" && Array.isArray(copy.versions)) {
    copy.versions = copy.versions.map((version, versionIndex) => ({
      ...version,
      versionId: `${copy.id}-v${version.versionNumber || versionIndex + 1}`,
      revisionJobId: "",
    }));
  }
  targetUnit[collectionName] = [copy, ...targetCollection];
  return { added: true, item: copy, identity };
}
