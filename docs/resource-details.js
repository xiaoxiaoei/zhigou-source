const detailSchemas = {
  code: {
    label: "代码演示内容",
    fields: [
      { key: "language", label: "语言 / 环境", type: "select", options: ["Python", "C / C++", "Java", "JavaScript", "SQL", "Shell", "伪代码"] },
      { key: "code", label: "演示代码", type: "textarea", rows: 9, placeholder: "粘贴或编写课堂要运行的代码" },
      { key: "sampleInput", label: "示例输入 / 初始条件", type: "textarea", rows: 3, optional: true },
      { key: "walkthrough", label: "执行过程与观察重点", type: "textarea", rows: 5, placeholder: "说明关键变量、执行顺序和学生应该观察什么" },
      { key: "traceSteps", label: "单步追踪帧", type: "trace", optional: true },
    ],
  },
  lab: {
    label: "实验任务内容",
    fields: [
      { key: "objective", label: "实验目标", type: "textarea", rows: 3 },
      { key: "estimatedMinutes", label: "预计用时（分钟）", type: "number", min: 1 },
      { key: "prerequisites", label: "环境与前置条件", type: "textarea", rows: 3, optional: true },
      { key: "steps", label: "实验步骤", type: "list", placeholder: "填写一个可执行步骤" },
      { key: "deliverables", label: "提交物与验收证据", type: "textarea", rows: 4 },
      { key: "rubric", label: "评分量规", type: "rubric" },
    ],
  },
  case: {
    label: "教学案例内容",
    fields: [
      { key: "context", label: "案例背景", type: "textarea", rows: 4 },
      { key: "scenario", label: "案例材料 / 情境", type: "textarea", rows: 7 },
      { key: "questions", label: "课堂讨论问题", type: "list", placeholder: "填写一个由浅入深的问题" },
      { key: "teachingNotes", label: "教师引导与收束", type: "textarea", rows: 5 },
    ],
  },
};

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

export function normalizeResourceDetails(resource = {}, type = resource.type) {
  const schema = detailSchemas[type];
  if (!schema) return {};
  const source = resource.details && typeof resource.details === "object" ? resource.details : {};
  return Object.fromEntries(schema.fields.map(field => {
    const value = source[field.key];
    if (field.type === "number") return [field.key, Number(value || 0)];
    if (field.type === "list") return [field.key, Array.isArray(value) ? value.map(String).filter(Boolean) : String(value || "").split(/\n+/).map(item => item.trim()).filter(Boolean)];
    if (field.type === "rubric") return [field.key, Array.isArray(value) ? value.map(item => typeof item === "object" ? { criterion: String(item.criterion || ""), standard: String(item.standard || ""), points: Number(item.points || 0) } : { criterion: String(item), standard: "", points: 0 }) : String(value || "").split(/\n+/).map(item => item.trim()).filter(Boolean).map(item => ({ criterion: item, standard: "", points: 0 }))];
    if (field.type === "trace") return [field.key, Array.isArray(value) ? value.map((item, index) => typeof item === "object" ? { line: Number(item.line || index + 1), state: String(item.state || ""), explanation: String(item.explanation || "") } : { line: index + 1, state: "", explanation: String(item) }) : String(value || "").split(/\n+/).map(item => item.trim()).filter(Boolean).map((item, index) => ({ line: index + 1, state: "", explanation: item }))];
    return [field.key, String(value || "")];
  }));
}

export function validateResourceDetails(type, details = {}) {
  const schema = detailSchemas[type];
  if (!schema) return "";
  const missing = schema.fields.filter(field => {
    if (field.optional) return false;
    const value = details[field.key];
    if (field.type === "number") return Number(value) < (field.min || 1);
    if (field.type === "list") return !Array.isArray(value) || !value.some(item => String(item).trim());
    if (field.type === "rubric") return !Array.isArray(value) || !value.some(item => String(item?.criterion || "").trim() && String(item?.standard || "").trim() && Number(item?.points) > 0);
    if (field.type === "trace") return !Array.isArray(value) || !value.some(item => Number(item?.line) > 0 && (String(item?.state || "").trim() || String(item?.explanation || "").trim()));
    return !String(value || "").trim();
  });
  return missing.length ? `请完善：${missing.map(field => field.label).join("、")}` : "";
}

export function renderResourceDetailFields(container, type, resource = {}) {
  const schema = detailSchemas[type];
  if (!container) return;
  if (!schema) {
    container.innerHTML = '<div class="resource-detail-empty">动效内容请在动画实验室中播放、修改和管理版本。</div>';
    return;
  }
  const details = normalizeResourceDetails(resource, type);
  container.innerHTML = `<div class="resource-detail-heading"><b>${schema.label}</b><small>保存后进入当前教学单元和版本记录</small></div><div class="resource-detail-grid">${schema.fields.map(field => field.type === "list" ? listFieldMarkup(field, details[field.key]) : field.type === "rubric" ? rubricFieldMarkup(field, details[field.key]) : field.type === "trace" ? traceFieldMarkup(field, details[field.key]) : `<label class="${field.rows >= 6 ? "wide" : ""}"><span>${field.label}${field.optional ? "（可选）" : ""}</span>${field.type === "select" ? `<select data-resource-detail="${field.key}">${field.options.map(option => `<option ${option === details[field.key] ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}</select>` : field.type === "textarea" ? `<textarea data-resource-detail="${field.key}" rows="${field.rows || 3}" placeholder="${escapeHtml(field.placeholder || "")}">${escapeHtml(details[field.key])}</textarea>` : `<input data-resource-detail="${field.key}" type="number" min="${field.min || 1}" value="${details[field.key] || ""}">`}</label>`).join("")}</div>`;
  container.onclick = event => {
    const action = event.target.closest("[data-resource-list-action]");
    if (!action) return;
    const row = action.closest(".resource-list-row");
    if (action.dataset.resourceListAction === "remove") row?.remove();
    else if (action.dataset.resourceListAction === "up" && row?.previousElementSibling?.classList.contains("resource-list-row")) row.parentElement.insertBefore(row, row.previousElementSibling);
    else if (action.dataset.resourceListAction === "down" && row?.nextElementSibling?.classList.contains("resource-list-row")) row.parentElement.insertBefore(row.nextElementSibling, row);
    else if (action.dataset.resourceListAction === "add") {
      const wrap = action.closest("[data-resource-list-wrap]");
      action.insertAdjacentHTML("beforebegin", action.dataset.listKind === "rubric" ? rubricRowMarkup(action.dataset.resourceListActionKey, {}) : action.dataset.listKind === "trace" ? traceRowMarkup(action.dataset.resourceListActionKey, {}) : listRowMarkup(action.dataset.resourceListActionKey, "", action.dataset.placeholder || ""));
      wrap?.querySelector(".resource-list-row:last-of-type input, .resource-list-row:last-of-type textarea")?.focus();
    }
  };
}

export function readResourceDetailFields(container, type) {
  const schema = detailSchemas[type];
  if (!schema || !container) return {};
  return Object.fromEntries(schema.fields.map(field => {
    if (field.type === "list") return [field.key, [...container.querySelectorAll(`[data-detail-list-item="${field.key}"]`)].map(input => input.value.trim()).filter(Boolean)];
    if (field.type === "rubric") return [field.key, [...container.querySelectorAll(`[data-rubric-row="${field.key}"]`)].map(row => ({ criterion: row.querySelector('[data-rubric-field="criterion"]')?.value.trim() || "", standard: row.querySelector('[data-rubric-field="standard"]')?.value.trim() || "", points: Number(row.querySelector('[data-rubric-field="points"]')?.value || 0) })).filter(item => item.criterion || item.standard || item.points)];
    if (field.type === "trace") return [field.key, [...container.querySelectorAll(`[data-trace-row="${field.key}"]`)].map(row => ({ line: Number(row.querySelector('[data-trace-field="line"]')?.value || 0), state: row.querySelector('[data-trace-field="state"]')?.value.trim() || "", explanation: row.querySelector('[data-trace-field="explanation"]')?.value.trim() || "" })).filter(item => item.line || item.state || item.explanation)];
    const value = container.querySelector(`[data-resource-detail="${field.key}"]`)?.value ?? "";
    return [field.key, field.type === "number" ? Number(value || 0) : String(value).trim()];
  }));
}

function actionButtons() {
  return '<div class="resource-list-actions"><button type="button" data-resource-list-action="up" aria-label="上移">↑</button><button type="button" data-resource-list-action="down" aria-label="下移">↓</button><button type="button" data-resource-list-action="remove" aria-label="移除"><i class="ph ph-trash"></i></button></div>';
}

function listRowMarkup(key, value, placeholder) {
  return `<article class="resource-list-row"><textarea rows="2" data-detail-list-item="${key}" placeholder="${escapeHtml(placeholder)}">${escapeHtml(value)}</textarea>${actionButtons()}</article>`;
}

function listFieldMarkup(field, values = []) {
  return `<section class="resource-list-field wide" data-resource-list-wrap="${field.key}"><header><span>${field.label}${field.optional ? "（可选）" : ""}</span><small>可调整顺序</small></header>${values.map(value => listRowMarkup(field.key, value, field.placeholder || "")).join("")}<button class="resource-list-add" type="button" data-resource-list-action="add" data-resource-list-action-key="${field.key}" data-list-kind="list" data-placeholder="${escapeHtml(field.placeholder || "")}">＋ 添加一项</button></section>`;
}

function rubricRowMarkup(key, item = {}) {
  return `<article class="resource-list-row rubric-row" data-rubric-row="${key}"><input data-rubric-field="criterion" placeholder="评价维度" value="${escapeHtml(item.criterion || "")}"><input data-rubric-field="standard" placeholder="达标标准" value="${escapeHtml(item.standard || "")}"><input data-rubric-field="points" type="number" min="1" placeholder="分值" value="${Number(item.points || 0) || ""}">${actionButtons()}</article>`;
}

function rubricFieldMarkup(field, values = []) {
  return `<section class="resource-list-field wide" data-resource-list-wrap="${field.key}"><header><span>${field.label}</span><small>维度 · 达标标准 · 分值</small></header>${values.map(item => rubricRowMarkup(field.key, item)).join("")}<button class="resource-list-add" type="button" data-resource-list-action="add" data-resource-list-action-key="${field.key}" data-list-kind="rubric">＋ 添加评分维度</button></section>`;
}

function traceRowMarkup(key, item = {}) {
  return `<article class="resource-list-row trace-row" data-trace-row="${key}"><input data-trace-field="line" type="number" min="1" placeholder="行号" value="${Number(item.line || 0) || ""}"><input data-trace-field="state" placeholder="变量 / 状态，例如 x=1, lock=A" value="${escapeHtml(item.state || "")}"><input data-trace-field="explanation" placeholder="本步发生了什么，学生应观察什么" value="${escapeHtml(item.explanation || "")}">${actionButtons()}</article>`;
}

function traceFieldMarkup(field, values = []) {
  return `<section class="resource-list-field wide" data-resource-list-wrap="${field.key}"><header><span>${field.label}（可选）</span><small>行号 · 状态 · 解释；仅引导播放，不执行代码</small></header>${values.map(item => traceRowMarkup(field.key, item)).join("")}<button class="resource-list-add" type="button" data-resource-list-action="add" data-resource-list-action-key="${field.key}" data-list-kind="trace">＋ 添加追踪帧</button></section>`;
}
