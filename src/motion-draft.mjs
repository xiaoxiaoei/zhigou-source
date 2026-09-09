import { randomUUID } from 'node:crypto';
import { buildFreeformScene, assessFreeformScene } from './freeform-scene.mjs';
import { repairExplicitConnectors } from './connector-repair.mjs';

// Keep raw model output in the server job only. Only sanitized scenes reach preview.
export function createMotionDraft(raw, context, model, attempt) {
  const repaired = repairExplicitConnectors(String(raw.svgMarkup || raw.svg || ''));
  const scene = buildFreeformScene({ ...raw, svgMarkup: repaired.svg }, context);
  return { id: randomUUID(), attempt, createdAt: new Date().toISOString(), model,
    raw, scene, geometryFixes: repaired.fixes, quality: assessFreeformScene(scene) };
}

export function publicMotionDraft(draft) {
  const { raw, ...safe } = draft;
  return safe;
}

export function bestMotionDraft(drafts) {
  return [...drafts].sort((a,b) => {
    const score = d => (d.scene ? 0 : 1000) + d.quality.blockers.length * 100 + d.quality.warnings.length;
    return score(a)-score(b) || b.attempt-a.attempt;
  })[0];
}
