const DEFAULT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export function resourceDraftIdentity({ mode = "new", unitId = "", resourceId = "", resourceIndex = -1 } = {}) {
  if (mode === "new") return "new";
  const resourcePart = resourceId || `index-${Number(resourceIndex)}`;
  return unitId && resourcePart ? `edit:${unitId}:${resourcePart}` : "";
}

export function resourceFingerprint(resource = {}) {
  return JSON.stringify({
    type: String(resource.type || ""),
    title: String(resource.title || ""),
    purpose: String(resource.purpose || ""),
    status: String(resource.status || ""),
    keyPointIds: Array.isArray(resource.keyPointIds) ? resource.keyPointIds.map(String).filter(Boolean) : [],
    details: resource.details && typeof resource.details === "object" ? resource.details : {},
  });
}

export function createResourceDraft(context = {}, values = {}, now = Date.now()) {
  const identity = resourceDraftIdentity(context);
  if (!identity) return null;
  return {
    version: 1,
    identity,
    mode: context.mode === "edit" ? "edit" : "new",
    unitId: String(context.unitId || ""),
    resourceId: String(context.resourceId || ""),
    resourceIndex: Number(context.resourceIndex ?? -1),
    baseline: String(context.baseline || ""),
    targetUnitId: String(values.targetUnitId || ""),
    type: String(values.type || "motion"),
    title: String(values.title || ""),
    purpose: String(values.purpose || ""),
    status: String(values.status || "草稿"),
    keyPointIds: Array.isArray(values.keyPointIds) ? [...new Set(values.keyPointIds.map(String).filter(Boolean))] : [],
    details: values.details && typeof values.details === "object" ? structuredClone(values.details) : {},
    updatedAt: Number(now),
  };
}

export function validateResourceDraft(draft, context = {}, { now = Date.now(), maxAgeMs = DEFAULT_MAX_AGE_MS, unitIds = [] } = {}) {
  if (!draft || draft.version !== 1 || draft.identity !== resourceDraftIdentity(context)) return null;
  if (!Number.isFinite(draft.updatedAt) || now - draft.updatedAt > maxAgeMs || draft.updatedAt > now + 60_000) return null;
  if (draft.mode === "edit" && (draft.unitId !== String(context.unitId || "") || draft.baseline !== String(context.baseline || ""))) return null;
  if (draft.mode === "new" && draft.targetUnitId && unitIds.length && !unitIds.includes(draft.targetUnitId)) return null;
  return structuredClone(draft);
}

function readRecords(storage, storageKey) {
  try {
    const records = JSON.parse(storage?.getItem(storageKey) || "{}");
    return records && typeof records === "object" && !Array.isArray(records) ? records : {};
  } catch {
    return {};
  }
}

export function readResourceDraft(storage, storageKey, context, options) {
  const identity = resourceDraftIdentity(context);
  return identity ? validateResourceDraft(readRecords(storage, storageKey)[identity], context, options) : null;
}

export function writeResourceDraft(storage, storageKey, draft) {
  if (!storage || !draft?.identity) return false;
  const records = readRecords(storage, storageKey);
  records[draft.identity] = draft;
  const entries = Object.entries(records).sort((a, b) => Number(b[1]?.updatedAt || 0) - Number(a[1]?.updatedAt || 0)).slice(0, 20);
  try {
    storage.setItem(storageKey, JSON.stringify(Object.fromEntries(entries)));
    return true;
  } catch {
    return false;
  }
}

export function removeResourceDraft(storage, storageKey, context) {
  if (!storage) return false;
  const identity = resourceDraftIdentity(context);
  if (!identity) return false;
  const records = readRecords(storage, storageKey);
  if (!(identity in records)) return false;
  delete records[identity];
  try {
    if (Object.keys(records).length) storage.setItem(storageKey, JSON.stringify(records));
    else storage.removeItem(storageKey);
    return true;
  } catch {
    return false;
  }
}
