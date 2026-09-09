const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

function clean(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

export function unitSectionValue(unit = {}, section = "overview") {
  if (section === "overview") return { title: unit.title || "", course: unit.course || "", duration: unit.duration || "", overview: unit.overview || "", objectives: Array.isArray(unit.objectives) ? unit.objectives : [] };
  if (section === "knowledge") return Array.isArray(unit.keyPoints) ? unit.keyPoints : [];
  if (section === "lesson") return Array.isArray(unit.lesson?.flow) ? unit.lesson.flow : [];
  if (section === "assessment") return { questions: Array.isArray(unit.lesson?.questions) ? unit.lesson.questions : [], afterClass: Array.isArray(unit.lesson?.afterClass) ? unit.lesson.afterClass : [] };
  return null;
}

export function unitSectionFingerprint(unit, section) {
  return JSON.stringify(unitSectionValue(unit, section));
}

export function unitEditorDraftIdentity(unitId, section) {
  return unitId && section ? `${unitId}:${section}` : "";
}

export function createUnitEditorDraft({ unitId, section, baseline }, value, now = Date.now()) {
  const identity = unitEditorDraftIdentity(unitId, section);
  if (!identity) return null;
  return { version: 1, identity, unitId: String(unitId), section: String(section), baseline: String(baseline || ""), value: clean(value), updatedAt: Number(now) };
}

function records(storage, storageKey) {
  try {
    const parsed = JSON.parse(storage?.getItem(storageKey) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function validateUnitEditorDraft(draft, context, { now = Date.now(), maxAgeMs = MAX_AGE_MS } = {}) {
  if (!draft || draft.version !== 1 || draft.identity !== unitEditorDraftIdentity(context?.unitId, context?.section)) return null;
  if (draft.baseline !== String(context?.baseline || "")) return null;
  if (!Number.isFinite(draft.updatedAt) || now - draft.updatedAt > maxAgeMs || draft.updatedAt > now + 60_000) return null;
  return clean(draft);
}

export function readUnitEditorDraft(storage, storageKey, context, options) {
  const identity = unitEditorDraftIdentity(context?.unitId, context?.section);
  return identity ? validateUnitEditorDraft(records(storage, storageKey)[identity], context, options) : null;
}

export function writeUnitEditorDraft(storage, storageKey, draft) {
  if (!storage || !draft?.identity) return false;
  const current = records(storage, storageKey);
  current[draft.identity] = draft;
  const recent = Object.entries(current).sort((a, b) => Number(b[1]?.updatedAt || 0) - Number(a[1]?.updatedAt || 0)).slice(0, 30);
  try {
    storage.setItem(storageKey, JSON.stringify(Object.fromEntries(recent)));
    return true;
  } catch {
    return false;
  }
}

export function removeUnitEditorDraft(storage, storageKey, context) {
  if (!storage) return false;
  const identity = unitEditorDraftIdentity(context?.unitId, context?.section);
  const current = records(storage, storageKey);
  if (!identity || !(identity in current)) return false;
  delete current[identity];
  try {
    if (Object.keys(current).length) storage.setItem(storageKey, JSON.stringify(current));
    else storage.removeItem(storageKey);
    return true;
  } catch {
    return false;
  }
}
