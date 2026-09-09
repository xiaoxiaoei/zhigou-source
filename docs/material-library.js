const roleLabels = { primary: "主课件", textbook: "教材摘录", teacher: "教师补充", reference: "参考资料" };

function text(value = "") { return String(value || "").trim(); }

function materialSnapshot(material = {}) {
  return {
    role: roleLabels[material.role] && material.role !== "primary" ? material.role : "reference",
    title: text(material.title) || "未命名材料",
    content: text(material.pages?.[0]?.text),
    pages: structuredClone(material.pages||[]),
    archivedAt: material.archivedAt || "",
  };
}

function revisionId() { return `revision-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

function ensureRevisionBaseline(material = {}) {
  if (!Array.isArray(material.revisions)) material.revisions = [];
  if (!material.revisions.length) {
    material.revisions.push({ id: revisionId(), createdAt: material.createdAt || new Date().toISOString(), action: "创建材料", summary: "初始版本", snapshot: materialSnapshot(material) });
  }
  return material.revisions;
}

function revisionSummary(before = {}, after = {}) {
  const changes = [];
  if (before.title !== after.title) changes.push("名称");
  if (before.role !== after.role) changes.push("类型");
  if (before.content !== after.content) changes.push(`正文（${before.content?.length || 0} → ${after.content?.length || 0} 字）`);
  if (Boolean(before.archivedAt) !== Boolean(after.archivedAt)) changes.push(after.archivedAt ? "归档" : "恢复使用");
  return changes.length ? `变更：${changes.join("、")}` : "未改变内容";
}

function recordMaterialRevision(material, action, before) {
  const revisions = ensureRevisionBaseline(material), snapshot = materialSnapshot(material);
  const revision = { id: revisionId(), createdAt: new Date().toISOString(), action, summary: revisionSummary(before, snapshot), snapshot };
  revisions.push(revision);
  if (revisions.length > 30) revisions.splice(0, revisions.length - 30);
  return revision;
}

function recheckMaterialEvidence(unit, materialId, content) {
  const checkedAt = new Date().toISOString();
  for (const point of unit.keyPoints || []) {
    let touched = false;
    for (const evidence of point.evidence || []) if (evidence.materialId === materialId) {
      touched = true;
      if (content.includes(text(evidence.quote))) delete evidence.invalidatedAt;
      else evidence.invalidatedAt = checkedAt;
    }
    if (touched) point.evidenceReview = { status: "needs-review", reviewedAt: checkedAt };
  }
}

export function materialRoleLabel(role = "reference") { return roleLabels[role] || roleLabels.reference; }

export function listUnitMaterials(unit = {}) {
  const source = unit.source && typeof unit.source === "object" ? unit.source : {};
  const primary = {
    id: text(source.materialId) || "primary",
    role: "primary",
    kind: source.kind || "unknown",
    title: text(source.title || source.filename) || "主材料（名称未记录）",
    slideCount: Number(source.slideCount || 0),
    pages: Array.isArray(source.pages) ? source.pages : [],
  };
  const extras = (Array.isArray(unit.materials) ? unit.materials : []).filter(item => item && text(item.id) && item.id !== primary.id).map(item => ({
    id: text(item.id), role: roleLabels[item.role] ? item.role : "reference", kind: item.kind || "text", title: text(item.title) || "未命名材料",
    slideCount: Number(item.slideCount || item.pages?.length || 0), pages: Array.isArray(item.pages) ? item.pages : [], createdAt: item.createdAt || "", archivedAt: item.archivedAt || "", revisions: Array.isArray(item.revisions) ? item.revisions : [],
  }));
  return [primary, ...extras];
}

export function allMaterialPages(unit = {}) {
  return listUnitMaterials(unit).filter(material => !material.archivedAt).flatMap(material => material.pages.map(page => ({
    ...page, number: Number(page.number), materialId: material.id, materialTitle: material.title, materialRole: material.role,
  })).filter(page => Number.isFinite(page.number) && page.number > 0 && text(page.text)));
}

export function searchMaterialPages(unit = {}, query = "", options = {}) {
  const normalized = text(query).toLocaleLowerCase(), materialId = text(options.materialId) || "all";
  if (!normalized) return [];
  const terms = [...new Set(normalized.split(/[\s，,；;、]+/).map(text).filter(Boolean))].slice(0, 8);
  if (!terms.length) return [];
  return allMaterialPages(unit).filter(page => materialId === "all" || page.materialId === materialId).map(page => {
    const body = String(page.text || ""), haystack = `${page.title || ""}\n${body}`.toLocaleLowerCase();
    if (!terms.every(term => haystack.includes(term))) return null;
    const bodyLower = body.toLocaleLowerCase();
    const positions = terms.map(term => bodyLower.indexOf(term)).filter(position => position >= 0);
    const first = positions.length ? Math.min(...positions) : 0, start = Math.max(0, first - 54), end = Math.min(body.length, first + 150);
    const occurrences = terms.reduce((total, term) => total + Math.max(1, haystack.split(term).length - 1), 0);
    return {
      materialId: page.materialId, materialTitle: page.materialTitle, materialRole: page.materialRole,
      pageNumber: page.number, pageTitle: page.title || `第 ${page.number} 页`,
      snippet: `${start ? "…" : ""}${body.slice(start, end).replace(/\s+/g, " ").trim()}${end < body.length ? "…" : ""}`,
      terms, score: occurrences + (String(page.title || "").toLocaleLowerCase().includes(normalized) ? 4 : 0),
    };
  }).filter(Boolean).sort((a, b) => b.score - a.score || a.materialTitle.localeCompare(b.materialTitle, "zh-CN") || a.pageNumber - b.pageNumber).slice(0, Math.max(1, Math.min(50, Number(options.limit) || 20)));
}

export function materialImpact(unit = {}, materialId = "") {
  const points = (unit.keyPoints || []).map((point, index) => {
    const count = (point.evidence || []).filter(item => item.materialId === materialId).length;
    return count ? { index, title: point.title || `知识点 ${index + 1}`, evidenceCount: count } : null;
  }).filter(Boolean);
  return { materialId, affectedPoints: points, evidenceCount: points.reduce((sum, point) => sum + point.evidenceCount, 0) };
}

export function evidenceIsActive(unit = {}, evidence = {}) {
  if (!text(evidence.quote) || evidence.invalidatedAt) return false;
  const materialId = text(evidence.materialId) || "primary";
  if (materialId === "primary") return true;
  const material = (unit.materials || []).find(item => item?.id === materialId);
  return Boolean(material && !material.archivedAt);
}

export function updateTextMaterial(unit = {}, materialId = "", draft = {}) {
  const material = (unit.materials || []).find(item => item?.id === materialId);
  if (!material) return { updated: false, reason: "missing" };
  const title = text(draft.title), content = text(draft.content), role = roleLabels[draft.role] && draft.role !== "primary" ? draft.role : material.role;
  if (!title) return { updated: false, reason: "title" };
  if (content.length < 8) return { updated: false, reason: "content" };
  const impact = materialImpact(unit, materialId), before = materialSnapshot(material), changedContent = content !== before.content;
  ensureRevisionBaseline(material);
  const pages=structuredClone(material.pages||[]);pages[0]={...(pages[0]||{number:1}),title,text:content};
  Object.assign(material, { title, role, slideCount: pages.length, pages, updatedAt: new Date().toISOString() });
  if (changedContent) recheckMaterialEvidence(unit, materialId, pages.map(p=>p.text).join('\n'));
  const revision = recordMaterialRevision(material, "编辑材料", before);
  return { updated: true, material, impact, changedContent, revision };
}

export function setMaterialArchived(unit = {}, materialId = "", archived = true) {
  const material = (unit.materials || []).find(item => item?.id === materialId);
  if (!material) return { updated: false, reason: "missing" };
  const impact = materialImpact(unit, materialId), before = materialSnapshot(material);
  ensureRevisionBaseline(material);
  if (archived) material.archivedAt = new Date().toISOString(); else delete material.archivedAt;
  for (const point of unit.keyPoints || []) if ((point.evidence || []).some(item => item.materialId === materialId)) point.evidenceReview = { status: "needs-review", reviewedAt: new Date().toISOString() };
  const revision = recordMaterialRevision(material, archived ? "归档材料" : "恢复材料", before);
  return { updated: true, material, impact, archived, revision };
}

export function materialRevisionHistory(material = {}) {
  return [...(Array.isArray(material.revisions) ? material.revisions : [])].reverse();
}

export function restoreMaterialRevision(unit = {}, materialId = "", revisionIdValue = "") {
  const material = (unit.materials || []).find(item => item?.id === materialId);
  if (!material) return { updated: false, reason: "missing" };
  ensureRevisionBaseline(material);
  const target = material.revisions.find(item => item?.id === revisionIdValue && item.snapshot);
  if (!target) return { updated: false, reason: "revision" };
  const before = materialSnapshot(material), snapshot = target.snapshot;
  const pages=snapshot.pages?.length?structuredClone(snapshot.pages):[{number:1,title:snapshot.title,text:text(snapshot.content)}];
  Object.assign(material, { role: snapshot.role, title: snapshot.title, slideCount: pages.length, pages, updatedAt: new Date().toISOString() });
  if (snapshot.archivedAt) material.archivedAt = new Date().toISOString(); else delete material.archivedAt;
  recheckMaterialEvidence(unit, materialId, pages.map(p=>p.text).join('\n'));
  const revision = recordMaterialRevision(material, `恢复旧版：${target.action || "历史版本"}`, before);
  return { updated: true, material, impact: materialImpact(unit, materialId), restoredRevision: target, revision };
}

export function addTextMaterial(unit = {}, draft = {}, idFactory = () => crypto.randomUUID()) {
  const title = text(draft.title), content = text(draft.content), role = roleLabels[draft.role] && draft.role !== "primary" ? draft.role : "reference";
  if (!title) return { added: false, reason: "title" };
  if (content.length < 8) return { added: false, reason: "content" };
  const id = `material-${idFactory()}`;
  const material = { id, role, kind: "text", title, slideCount: 1, pages: [{ number: 1, title, text: content.slice(0, 12000) }], createdAt: new Date().toISOString(), revisions: [] };
  ensureRevisionBaseline(material);
  unit.materials = [...(Array.isArray(unit.materials) ? unit.materials : []), material];
  return { added: true, material };
}
