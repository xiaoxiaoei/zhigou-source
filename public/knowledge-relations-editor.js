const relationTypes = {
  prerequisite: "先修",
  causes: "因果",
  contrasts: "对比",
  part: "组成",
  supports: "支撑",
};

function pointId(point, index) {
  return point.id || `kp-${index + 1}-${crypto.randomUUID().slice(0, 8)}`;
}

export function normalizeKnowledgeRelations(points = [], relations = []) {
  const normalizedPoints = points.map((point, index) => ({ ...point, id: pointId(point, index) }));
  const ids = new Set(normalizedPoints.map(point => point.id));
  const normalizedRelations = relations.map((relation, index) => ({
    id: relation.id || `kr-${index + 1}-${crypto.randomUUID().slice(0, 8)}`,
    from: String(relation.from || relation.source || ""),
    to: String(relation.to || relation.target || ""),
    type: relationTypes[relation.type] ? relation.type : "prerequisite",
    note: String(relation.note || relation.reason || ""),
  })).filter(relation => ids.has(relation.from) && ids.has(relation.to) && relation.from !== relation.to);
  return { points: normalizedPoints, relations: normalizedRelations };
}

export function createKnowledgeRelationsEditor({ getUnit, ensureEditable, onSave, showToast }) {
  const style = document.createElement("link");
  style.rel = "stylesheet";
  style.href = "/knowledge-relations-editor.css";
  document.head.append(style);
  document.body.insertAdjacentHTML("beforeend", `<dialog class="create-dialog" id="knowledgeRelationsDialog"><form method="dialog" class="dialog-shell relation-editor"><header><div><h2>校正知识关系</h2><p>确认哪些知识需要先学、哪些存在因果、对比、组成或支撑关系。</p></div><button class="dialog-close" value="cancel" aria-label="关闭窗口"><i class="ph ph-x"></i></button></header><div class="relation-editor-body"><div class="relation-guidance"><i class="ph ph-path"></i><p><b>只保留有教学意义的关系。</b><br>不要因为知识点相邻就自动认定存在先修或因果。</p></div><div id="knowledgeRelationList"></div><button class="structured-add" id="addKnowledgeRelation" type="button">＋ 添加知识关系</button><div class="dialog-error hidden" id="knowledgeRelationError"><i class="ph ph-warning-circle"></i><span></span></div></div><footer><span id="knowledgeRelationCount"></span><div><button class="button ghost" value="cancel">取消</button><button class="button dark" id="saveKnowledgeRelations" type="button">保存新版本</button></div></footer></form></dialog>`);

  const dialog = document.querySelector("#knowledgeRelationsDialog");
  const list = document.querySelector("#knowledgeRelationList");
  const error = document.querySelector("#knowledgeRelationError");
  let points = [];
  let relations = [];

  const optionMarkup = selected => points.map(point => `<option value="${point.id}" ${point.id === selected ? "selected" : ""}>${escapeHtml(point.title)}</option>`).join("");
  const typeMarkup = selected => Object.entries(relationTypes).map(([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`).join("");

  function escapeHtml(value = "") {
    return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  }

  function renderEditor() {
    error.classList.add("hidden");
    list.innerHTML = relations.length ? relations.map((relation, index) => `<article class="relation-row" data-relation-index="${index}"><span>${String(index + 1).padStart(2, "0")}</span><label>起点<select data-field="from">${optionMarkup(relation.from)}</select></label><label>关系<select data-field="type">${typeMarkup(relation.type)}</select></label><label>终点<select data-field="to">${optionMarkup(relation.to)}</select></label><label class="relation-note">教学说明<input data-field="note" value="${escapeHtml(relation.note)}" placeholder="例如：理解临界区后才能判断加锁边界"></label><button type="button" data-remove-relation="${index}" aria-label="移除关系" title="移除关系"><i class="ph ph-trash"></i></button></article>`).join("") : '<div class="relation-empty"><b>还没有明确的知识关系</b><p>如果这些知识点可以独立讲授，可以保持为空。</p></div>';
    document.querySelector("#knowledgeRelationCount").textContent = `${relations.length} 条知识关系`;
  }

  function open() {
    const unit = ensureEditable();
    const normalized = normalizeKnowledgeRelations(unit.keyPoints || [], unit.knowledgeRelations || []);
    points = structuredClone(normalized.points);
    relations = structuredClone(normalized.relations);
    renderEditor();
    dialog.showModal();
  }

  list.addEventListener("input", event => {
    const row = event.target.closest("[data-relation-index]");
    const field = event.target.dataset.field;
    if (!row || !field) return;
    relations[Number(row.dataset.relationIndex)][field] = event.target.value;
  });
  list.addEventListener("click", event => {
    const button = event.target.closest("[data-remove-relation]");
    if (!button) return;
    relations.splice(Number(button.dataset.removeRelation), 1);
    renderEditor();
  });
  document.querySelector("#addKnowledgeRelation").onclick = () => {
    if (points.length < 2) {
      error.querySelector("span").textContent = "至少需要两个知识点才能建立关系。";
      error.classList.remove("hidden");
      return;
    }
    relations.push({ id: crypto.randomUUID(), from: points[0].id, to: points[1].id, type: "prerequisite", note: "" });
    renderEditor();
  };
  document.querySelector("#saveKnowledgeRelations").onclick = () => {
    if (relations.some(relation => relation.from === relation.to)) {
      error.querySelector("span").textContent = "知识关系的起点和终点不能相同。";
      error.classList.remove("hidden");
      return;
    }
    const unit = getUnit();
    unit.keyPoints = points;
    unit.knowledgeRelations = relations.map(relation => ({ ...relation, note: relation.note.trim() }));
    onSave("更新知识关系", `确认了 ${unit.knowledgeRelations.length} 条先修、因果、对比、组成或支撑关系。`);
    dialog.close();
    showToast("知识关系已保存为新版本");
  };

  function renderSummary() {
    const panel = document.querySelector("#knowledgePanel");
    if (!panel) return;
    let toolbar = panel.querySelector(".relation-edit-toolbar");
    if (!toolbar) {
      toolbar = document.createElement("div");
      toolbar.className = "relation-edit-toolbar";
      toolbar.innerHTML = '<span><b>知识关系</b><small>校正先修、因果、对比、组成与支撑</small></span><button class="button outline" type="button"><i class="ph ph-path"></i> 编辑关系</button>';
      toolbar.querySelector("button").onclick = open;
      const existing = panel.querySelector(".section-edit-toolbar");
      if (existing) existing.after(toolbar); else panel.prepend(toolbar);
    }
    panel.querySelector(".knowledge-relation-summary")?.remove();
    const unit = getUnit();
    const normalized = normalizeKnowledgeRelations(unit?.keyPoints || [], unit?.knowledgeRelations || []);
    if (!normalized.relations.length) return;
    const names = new Map(normalized.points.map(point => [point.id, point.title]));
    const summary = document.createElement("section");
    summary.className = "knowledge-relation-summary";
    summary.innerHTML = `<header><b>已确认的知识路径</b><small>${normalized.relations.length} 条关系</small></header><div>${normalized.relations.map(relation => `<span><em>${escapeHtml(names.get(relation.from) || "未知知识点")}</em><i>${relationTypes[relation.type]}</i><em>${escapeHtml(names.get(relation.to) || "未知知识点")}</em>${relation.note ? `<small>${escapeHtml(relation.note)}</small>` : ""}</span>`).join("")}</div>`;
    toolbar.after(summary);
  }

  const observer = new MutationObserver(() => {
    if (!document.querySelector("#knowledgePanel .relation-edit-toolbar")) queueMicrotask(renderSummary);
  });
  observer.observe(document.querySelector("#knowledgePanel"), { childList: true });
  renderSummary();
  return { open, renderSummary };
}
