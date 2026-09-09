const snapshotFields = [
  "title", "course", "chapter", "duration", "status", "completion", "updated", "source", "materials", "teachingContext",
  "overview", "objectives", "keyPoints", "knowledgeRelations", "teachingAlignment", "lesson", "resources", "improvementActions", "warnings", "partial", "motionPlans",
];

function clone(value) {
  return value == null ? value : structuredClone(value);
}

export function createUnitSnapshot(unit = {}) {
  return Object.fromEntries(snapshotFields.map(field => [field, clone(unit[field])]).filter(([, value]) => value !== undefined));
}

export function applyUnitSnapshot(unit, snapshot) {
  if (!unit || !snapshot) return unit;
  for (const field of snapshotFields) {
    if (Object.prototype.hasOwnProperty.call(snapshot, field)) unit[field] = clone(snapshot[field]);
    else if (field === "knowledgeRelations") unit[field] = [];
  }
  return unit;
}

export function snapshotEquals(left, right) {
  return JSON.stringify(createUnitSnapshot(left)) === JSON.stringify(createUnitSnapshot(right));
}
