const STORE_KEY = "zhigou-teaching-insights-v1";

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function parseCsvLine(line) {
  const cells = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && quoted && line[index + 1] === '"') { value += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { cells.push(value.trim()); value = ""; }
    else value += char;
  }
  cells.push(value.trim());
  return cells;
}

export function parseInsightCsv(text = "") {
  const lines = String(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  const rows = lines.map(parseCsvLine);
  const header = rows[0].map((cell) => cell.toLowerCase());
  const aliases = {
    unit: ["教学单元", "单元", "unit"],
    type: ["证据类型", "类型", "type"],
    evidence: ["观察证据", "证据", "evidence"],
    issue: ["主要问题", "错因", "issue"],
    adjustment: ["下次调整", "调整", "adjustment"],
  };
  const indexes = Object.fromEntries(Object.entries(aliases).map(([key, names]) => [key, header.findIndex((cell) => names.includes(cell))]));
  const hasHeader = indexes.evidence >= 0;
  return rows.slice(hasHeader ? 1 : 0).map((row) => ({
    unitTitle: row[indexes.unit >= 0 ? indexes.unit : 0] || "",
    type: row[indexes.type >= 0 ? indexes.type : 1] || "课堂观察",
    evidence: row[indexes.evidence >= 0 ? indexes.evidence : 2] || "",
    issue: row[indexes.issue >= 0 ? indexes.issue : 3] || "",
    adjustment: row[indexes.adjustment >= 0 ? indexes.adjustment : 4] || "",
  })).filter((row) => row.evidence);
}

function loadRecords() {
  try { const value = JSON.parse(localStorage.getItem(STORE_KEY) || "[]"); return Array.isArray(value) ? value : []; }
  catch { return []; }
}

export function createTeachingInsights({ getUnits, showToast, onPlan, onOpenUnit }) {
  const style = document.createElement("link"); style.rel = "stylesheet"; style.href = "./teaching-insights.css"; document.head.append(style);
  document.body.insertAdjacentHTML("beforeend", `<dialog class="create-dialog" id="insightDialog"><div class="dialog-shell insight-dialog-shell"><header><div><span class="section-kicker">AFTER-CLASS EVIDENCE</span><h2 id="insightDialogTitle">记录课后复盘</h2></div><button class="dialog-close" id="closeInsightDialog" type="button" aria-label="关闭窗口"><i class="ph ph-x"></i></button></header><div class="insight-mode-tabs"><button class="active" type="button" data-insight-mode="manual">手动记录</button><button type="button" data-insight-mode="csv">CSV 批量导入</button></div><div class="dialog-body"><section data-insight-pane="manual"><div class="form-row"><label>关联教学单元<select id="insightUnit"></select></label><label>证据类型<select id="insightType"><option>课堂观察</option><option>课堂测验</option><option>作业错因</option><option>实验表现</option><option>学生反馈</option></select></label></div><label>可观察证据<textarea id="insightEvidence" rows="4" placeholder="例如：18/32 名学生把临界区等同于整个线程"></textarea></label><label>主要问题或错因<textarea id="insightIssue" rows="3" placeholder="说明学生的理解停在哪一层"></textarea></label><label>下次调整<textarea id="insightAdjustment" rows="3" placeholder="例如：下次先用一个过度加锁反例，再让学生缩小锁范围"></textarea></label></section><section class="hidden" data-insight-pane="csv"><div class="insight-import-guide"><b>支持表头</b><span>教学单元, 证据类型, 观察证据, 主要问题, 下次调整</span></div><label>粘贴 CSV 内容<textarea id="insightCsv" rows="11" placeholder="进程同步,课堂测验,18/32 人答错执行交错,把加一误认为原子操作,增加单步写回对比"></textarea></label></section><div class="dialog-error hidden" id="insightError"><i class="ph ph-warning-circle"></i><span></span></div></div><footer><span id="insightDialogNote">内容只保存在本机</span><div><button class="button ghost" id="cancelInsight" type="button">取消</button><button class="button dark" id="saveInsight" type="button">保存复盘</button></div></footer></div></dialog>`);
  let records = loadRecords();
  let mode = "manual";
  let editingId = null;
  const view = document.querySelector("#insightsView");
  const dialog = document.querySelector("#insightDialog");

  function personalUnits() { return getUnits().filter((unit) => !unit.isDemo); }
  function persist() { localStorage.setItem(STORE_KEY, JSON.stringify(records)); }
  function unitName(id) { return getUnits().find((unit) => unit.id === id)?.title || "未关联教学单元"; }
  function setMode(next) {
    mode = next;
    dialog.querySelectorAll("[data-insight-mode]").forEach((button) => button.classList.toggle("active", button.dataset.insightMode === mode));
    dialog.querySelectorAll("[data-insight-pane]").forEach((pane) => pane.classList.toggle("hidden", pane.dataset.insightPane !== mode));
    document.querySelector("#saveInsight").textContent = mode === "csv" ? "导入复盘" : editingId ? "保存修改" : "保存复盘";
  }
  function render() {
    const uniqueUnits = new Set(records.map((record) => record.unitId).filter(Boolean)).size;
    const pending = records.filter((record) => record.adjustment).length;
    const body = view.querySelector(".insight-content");
    if (!body) return;
    body.innerHTML = records.length ? `<div class="insight-summary"><article><span>已记录证据</span><strong>${records.length}</strong><small>条可回看课堂证据</small></article><article><span>覆盖教学单元</span><strong>${uniqueUnits}</strong><small>个单元形成复盘</small></article><article><span>下次调整</span><strong>${pending}</strong><small>项可执行改进</small></article></div><div class="insight-list-heading"><div><h2>课后复盘记录</h2></div><button class="button dark" type="button" data-new-insight><i class="ph ph-plus"></i> 新建复盘</button></div><div class="insight-records">${records.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map((record) => {const unit=getUnits().find(item=>item.id===record.unitId),planned=unit?.improvementActions?.some(item=>item.insightId===record.id);return `<article class="insight-record"><header><span>${escapeHtml(record.type)}</span><time>${new Date(record.createdAt).toLocaleDateString("zh-CN")}</time></header><h3>${escapeHtml(unitName(record.unitId))}</h3><div><b>证据</b><p>${escapeHtml(record.evidence)}</p></div>${record.issue ? `<div><b>问题判断</b><p>${escapeHtml(record.issue)}</p></div>` : ""}${record.adjustment ? `<div class="adjustment"><b>下次调整</b><p>${escapeHtml(record.adjustment)}</p></div>` : ""}<footer><button type="button" data-edit-insight="${escapeHtml(record.id)}"><i class="ph ph-pencil-simple"></i> 编辑复盘</button>${record.adjustment?`<button type="button" data-plan-insight="${escapeHtml(record.id)}" ${planned?"disabled":""}><i class="ph ${planned?"ph-check":"ph-arrow-bend-down-right"}"></i> ${planned?"已加入调整清单":"加入下一版备课"}</button>`:""}<button type="button" data-open-insight-unit="${escapeHtml(record.unitId)}"><i class="ph ph-arrow-square-out"></i> 打开教学单元</button></footer></article>`}).join("")}</div>` : `<div class="insight-empty"><div class="insight-orbit"><i class="ph ph-chart-polar"></i></div><h2>暂无课后复盘</h2><p>可记录课堂观察、测验结果或作业反馈。</p><button class="button dark" type="button" data-new-insight>创建第一份课后复盘</button></div>`;
  }
  function showError(message) { document.querySelector("#insightError span").textContent = message; document.querySelector("#insightError").classList.remove("hidden"); }
  function open(nextMode = "manual", record = null) {
    const units = personalUnits();
    editingId = record?.id || null;
    document.querySelector("#insightDialogTitle").textContent = editingId ? "编辑课后复盘" : nextMode === "csv" ? "导入学习数据" : "记录课后复盘";
    document.querySelector("#insightUnit").innerHTML = units.length ? units.map((unit) => `<option value="${escapeHtml(unit.id)}">${escapeHtml(unit.title)}</option>`).join("") : '<option value="">暂无个人教学单元</option>';
    document.querySelector("#insightUnit").value = record?.unitId || units[0]?.id || "";
    document.querySelector("#insightType").value = record?.type || "课堂观察";
    document.querySelector("#insightEvidence").value = record?.evidence || "";
    document.querySelector("#insightIssue").value = record?.issue || "";
    document.querySelector("#insightAdjustment").value = record?.adjustment || "";
    document.querySelector("#insightCsv").value = "";
    document.querySelector("#insightError").classList.add("hidden");
    setMode(editingId ? "manual" : nextMode);
    dialog.showModal();
  }
  function save() {
    document.querySelector("#insightError").classList.add("hidden");
    if (mode === "csv") {
      const rows = parseInsightCsv(document.querySelector("#insightCsv").value);
      if (!rows.length) return showError("没有识别到包含观察证据的 CSV 记录。");
      const units = personalUnits();
      if (!units.length) return showError("请先创建一个个人教学单元，再导入学习数据。");
      records.push(...rows.map((row) => ({ id: `i${Date.now()}${Math.random().toString(36).slice(2, 6)}`, unitId: units.find((unit) => unit.title === row.unitTitle || unit.title.includes(row.unitTitle))?.id || units[0]?.id || "", type: row.type, evidence: row.evidence, issue: row.issue, adjustment: row.adjustment, createdAt: new Date().toISOString() })));
      persist(); render(); dialog.close(); showToast(`已导入 ${rows.length} 条课后证据`); return;
    }
    const unitId = document.querySelector("#insightUnit").value;
    const evidence = document.querySelector("#insightEvidence").value.trim();
    if (!unitId) return showError("请先创建一个个人教学单元。");
    if (evidence.length < 6) return showError("请填写具体、可观察的课堂证据。");
    const payload = { unitId, type: document.querySelector("#insightType").value, evidence, issue: document.querySelector("#insightIssue").value.trim(), adjustment: document.querySelector("#insightAdjustment").value.trim() };
    const existing = records.find((record) => record.id === editingId);
    if (existing) Object.assign(existing, payload, { updatedAt: new Date().toISOString() });
    else records.push({ ...payload, id: `i${Date.now()}`, createdAt: new Date().toISOString() });
    persist(); render(); dialog.close(); showToast(existing ? "课后复盘已更新" : "课后复盘已保存");
  }

  view.querySelector(".page-heading .button").id = "importInsightData";
  view.querySelector(".page-heading").insertAdjacentHTML("afterend", '<div class="insight-content"></div>');
  view.querySelector(".insight-empty")?.remove();
  view.addEventListener("click", (event) => { const create = event.target.closest("[data-new-insight]"); if (create) open("manual"); const edit = event.target.closest("[data-edit-insight]"); if (edit) open("manual", records.find((record) => record.id === edit.dataset.editInsight)); const plan=event.target.closest("[data-plan-insight]");if(plan&&!plan.disabled){const record=records.find(item=>item.id===plan.dataset.planInsight);if(record&&onPlan?.(record)!==false)render()} const openUnit=event.target.closest("[data-open-insight-unit]");if(openUnit)onOpenUnit?.(openUnit.dataset.openInsightUnit); });
  document.querySelector("#importInsightData").onclick = () => open("csv");
  dialog.querySelectorAll("[data-insight-mode]").forEach((button) => button.onclick = () => setMode(button.dataset.insightMode));
  document.querySelector("#closeInsightDialog").onclick = () => dialog.close();
  document.querySelector("#cancelInsight").onclick = () => dialog.close();
  document.querySelector("#saveInsight").onclick = save;
  render();
  return { render, open, records: () => records.slice() };
}
