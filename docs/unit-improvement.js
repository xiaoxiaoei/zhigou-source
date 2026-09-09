export function normalizeImprovementActions(items = []) {
  return (Array.isArray(items) ? items : []).map((item, index) => ({
    id: item?.id || `improvement-${index + 1}`,
    insightId: item?.insightId || "",
    text: String(item?.text || "").trim(),
    evidence: String(item?.evidence || "").trim(),
    issue: String(item?.issue || "").trim(),
    status: item?.status === "done" ? "done" : "pending",
    createdAt: item?.createdAt || "",
    completedAt: item?.completedAt || "",
  })).filter(item => item.text);
}

export function addInsightImprovement(unit = {}, record = {}) {
  const actions = normalizeImprovementActions(unit.improvementActions);
  const insightId = String(record.id || "");
  const existing = actions.find(item => insightId && item.insightId === insightId);
  if (existing) return { added: false, action: existing, actions };
  const action = {
    id: `improvement-${insightId || Date.now()}`,
    insightId,
    text: String(record.adjustment || "").trim(),
    evidence: String(record.evidence || "").trim(),
    issue: String(record.issue || "").trim(),
    status: "pending",
    createdAt: new Date().toISOString(),
    completedAt: "",
  };
  if (!action.text) return { added: false, action: null, actions };
  actions.unshift(action);
  unit.improvementActions = actions;
  return { added: true, action, actions };
}

export function toggleImprovementAction(unit = {}, actionId = "", now = new Date().toISOString()) {
  const actions = normalizeImprovementActions(unit.improvementActions);
  const action = actions.find(item => item.id === actionId);
  if (!action) return null;
  action.status = action.status === "done" ? "pending" : "done";
  action.completedAt = action.status === "done" ? now : "";
  unit.improvementActions = actions;
  return action;
}

export function improvementProgress(unit = {}) {
  const actions = normalizeImprovementActions(unit.improvementActions);
  const done = actions.filter(item => item.status === "done").length;
  return { total: actions.length, done, pending: actions.length - done, percent: actions.length ? Math.round(done / actions.length * 100) : 0 };
}
