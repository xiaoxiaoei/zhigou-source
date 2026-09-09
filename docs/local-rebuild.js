export const fingerprint = value => JSON.stringify(value);
export function localTarget(unit, kind, index) {
  return (kind === 'knowledge' ? unit.keyPoints : kind === 'question' ? unit.lesson?.questions : unit.resources)?.[index];
}
export function relatedItems(unit, pointId) {
  const linked = item => item.keyPointId === pointId || item.knowledgePointId === pointId || item.keyPointIds?.includes(pointId);
  return [
    ...(unit.animations || []).map((item, index) => ({ kind: 'motion', index, item })),
    ...(unit.resources || []).map((item, index) => ({ kind: 'resource', index, item })),
    ...(unit.lesson?.questions || []).map((item, index) => ({ kind: 'question', index, item })),
    ...(unit.lesson?.flow || []).map((item, index) => ({ kind: 'activity', index, item })),
  ].filter(row => linked(row.item));
}
export function applyLocalResult(unit, pending) {
  const current = localTarget(unit, pending.kind, pending.index);
  if (!current || fingerprint(current) !== pending.baseline) throw Error('原条目已变化，请保留当前内容并重新生成');
  const fields = pending.kind === 'knowledge' ? ['title', 'logic', 'question', 'misconception'] : pending.kind === 'question' ? ['prompt', 'answerCue', 'misconception'] : ['title', 'purpose', 'details'];
  const next = { ...current };
  next.contentReview = { status: 'verified', at: new Date().toISOString() };
  for (const field of fields) if (pending.value[field] !== undefined) next[field] = structuredClone(pending.value[field]);
  if (pending.kind === 'knowledge') {
    next.evidenceReviewed = false;
    next.evidenceReview = { status: 'needs-review' };
    for (const row of relatedItems(unit, current.id)) row.item.contentReview = { status: 'needs-review', reason: `知识点“${next.title}”已更新`, at: new Date().toISOString() };
    for (const plan of unit.motionPlans || []) if (plan.knowledgePointId === current.id) plan.status = 'stale';
    unit.keyPoints[pending.index] = next;
  } else if (pending.kind === 'question') unit.lesson.questions[pending.index] = next;
  else unit.resources[pending.index] = next;
  unit.pendingLocalResult = null;
  return next;
}
