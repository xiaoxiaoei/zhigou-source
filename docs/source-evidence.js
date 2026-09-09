import { locateQuoteInContext } from "./source-context.js";
import { allMaterialPages, evidenceIsActive, listUnitMaterials, materialRoleLabel } from "./material-library.js";
const sourceNames = { ppt: "PPT 课件", word: "Word 文档（按正文片段定位）", pdf: "PDF 文档", outline: "章节大纲", concept: "单个知识点", task: "自由任务", unknown: "来源未记录" };

export function summarizeEvidenceCoverage(points = []) {
  const total = points.length;
  const supported = points.filter(point => Array.isArray(point.evidence) && point.evidence.some(item => String(item?.quote || "").trim())).length;
  const reviewed = points.filter(point => point.evidenceReview?.status === "verified").length;
  const needsReview = points.filter(point => point.evidenceReview?.status === "needs-review").length;
  return { total, supported, unsupported: Math.max(0, total - supported), reviewed, needsReview };
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function evidenceItems(point = {}, unit = {}) {
  return (Array.isArray(point.evidence) ? point.evidence : []).filter(item => String(item?.quote || "").trim() && evidenceIsActive(unit,item));
}

export function normalizeEvidenceDraft(rows = []) {
  return (Array.isArray(rows) ? rows : []).map(item => {
    const materialId = String(item?.materialId || "").trim();
    return { quote: String(item?.quote || "").trim(), slideNumber: Math.max(0, Math.trunc(Number(item?.slideNumber) || 0)) || undefined, ...(materialId && materialId !== "primary" ? { materialId } : {}), origin: item?.origin === "model" ? "model" : "teacher" };
  }).filter(item => item.quote);
}

function relevanceTerms(value = "") {
  const text = String(value).toLowerCase().replace(/\s+/g, "");
  const terms = new Set((String(value).toLowerCase().match(/[a-z0-9_]{2,}/g) || []));
  const chinese = [...text].filter(char => /[\p{Script=Han}]/u.test(char));
  for (let index = 0; index < chinese.length - 1; index += 1) terms.add(chinese[index] + chinese[index + 1]);
  return [...terms];
}

export function buildEvidenceCandidates(pages = [], query = "", options = {}) {
  const maxItems = Math.max(1, Number(options.maxItems || 10));
  const minChars = Math.max(4, Number(options.minChars || 8));
  const maxChars = Math.max(minChars, Number(options.maxChars || 220));
  const terms = relevanceTerms(query);
  const seen = new Set(), candidates = [];
  for (const page of Array.isArray(pages) ? pages : []) {
    const number = Math.max(0, Math.trunc(Number(page?.number) || 0));
    if (!number) continue;
    const title = String(page?.title || `第 ${number} 页`).trim();
    const segments = String(page?.text || "").replace(/\r/g, "").match(/[^。！？；\n]+[。！？；]?/gu) || [];
    for (const segment of segments) {
      const quote = segment.trim().slice(0, maxChars);
      if (quote.length < minChars || seen.has(quote)) continue;
      seen.add(quote);
      const haystack = `${title}${quote}`.toLowerCase();
      const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? (term.length > 2 ? 3 : 1) : 0), 0);
      candidates.push({ pageNumber: number, pageTitle: title, quote, score, materialId: String(page?.materialId || "primary"), materialTitle: String(page?.materialTitle || "主材料") });
    }
  }
  return candidates.sort((a, b) => b.score - a.score || a.pageNumber - b.pageNumber || b.quote.length - a.quote.length).slice(0, maxItems);
}

export function createSourceEvidenceInspector({ getUnit, ensureEditable, onSave, showToast }) {
  const style = document.createElement("link");
  style.rel = "stylesheet";
  style.href = "./source-evidence.css";
  document.head.append(style);
  const editorStyle = document.createElement("link");
  editorStyle.rel = "stylesheet";
  editorStyle.href = "./source-evidence-editor.css";
  document.head.append(editorStyle);
  const pickerStyle = document.createElement("link");
  pickerStyle.rel = "stylesheet";
  pickerStyle.href = "./source-evidence-picker.css";
  document.head.append(pickerStyle);
  document.body.insertAdjacentHTML("beforeend", `<dialog class="create-dialog" id="sourceEvidenceDialog"><form method="dialog" class="dialog-shell evidence-dialog-shell"><header><div><h2 id="evidencePointTitle">知识点来源</h2><p id="evidencePointLogic"></p></div><button class="dialog-close" value="cancel" aria-label="关闭窗口"><i class="ph ph-x"></i></button></header><div class="evidence-dialog-body"><div class="evidence-source-meta" id="evidenceSourceMeta"></div><div id="evidenceQuoteList"></div><section class="evidence-context-panel hidden" id="evidenceContextPanel"></section><section class="evidence-candidate-picker hidden" id="evidenceCandidatePicker"></section><details class="evidence-editor"><summary>补充或修正证据</summary><p>请粘贴材料中的原文，不要填写自己的结论。修改后原“已核对”状态会失效，需要重新核对。</p><div id="evidenceEditorRows"></div><button class="button outline" id="addEvidenceRow" type="button"><i class="ph ph-plus"></i> 添加一条原文</button><button class="button dark" id="saveEvidenceRows" type="button">保存证据修改</button></details><div class="evidence-review-note"><i class="ph ph-shield-check"></i><p><b>核对的是“模型归纳是否忠实于材料”</b><br>“已核对”不表示材料本身绝对正确，只表示当前知识点没有超出所列原文。</p></div></div><footer><span id="evidenceReviewState"></span><div><button class="button ghost" id="markEvidenceReview" type="button">需要复核</button><button class="button dark" id="verifyEvidence" type="button">标记已核对</button></div></footer></form></dialog>`);

  const dialog = document.querySelector("#sourceEvidenceDialog");
  let activeIndex = -1;
  const positionLabel=(number,materialId="primary")=>listUnitMaterials(getUnit()).find(m=>m.id===materialId)?.kind==="word"?`片段 ${number}`:`第 ${number} 页`;

  function evidenceRow(item = {}, materialTitle = "主材料") {
    const row = document.createElement("div");
    row.className = "evidence-editor-row";
    row.dataset.materialId = item.materialId || "primary";
    row.innerHTML = `<small class="evidence-row-material">${escapeHtml(materialTitle)}</small><label>页码/片段号<input type="number" min="1" value="${Number(item.slideNumber) || ""}" placeholder="可选"></label><label>材料原文<textarea rows="3" placeholder="粘贴能直接支持该知识点的原文">${escapeHtml(item.quote || "")}</textarea></label><button type="button" aria-label="删除这条证据"><i class="ph ph-trash"></i></button>`;
    row.querySelector("button").onclick = () => row.remove();
    return row;
  }

  function sourceMeta(unit) {
    const source = unit?.source || {};
    const kind = source.kind || source.mode || "unknown";
    const materials = listUnitMaterials(unit), pages = allMaterialPages(unit);
    return {
      kind,
      label: sourceNames[kind] || sourceNames.unknown,
      title: source.title || source.filename || (unit?.isDemo ? "内置体验示例" : "未记录材料名称"),
      count: materials.reduce((sum, material) => sum + Number(material.slideCount || material.pages.length || 0), 0), pages, materials,
    };
  }

  function reviewLabel(point) {
    if (point?.evidenceReview?.status === "verified") return "教师已核对";
    if (point?.evidenceReview?.status === "needs-review") return "教师标记为需复核";
    return "尚未人工核对";
  }

  function open(index, options = {}) {
    const unit = getUnit();
    const point = unit?.keyPoints?.[index];
    if (!point) return;
    activeIndex = index;
    const source = sourceMeta(unit);
    const items = evidenceItems(point,unit);
    document.querySelector("#evidencePointTitle").textContent = point.title || "知识点来源";
    document.querySelector("#evidencePointLogic").textContent = point.logic || point.coreLogic || point.explanation || "";
    document.querySelector("#evidenceSourceMeta").innerHTML = `<span><i class="ph ph-file-text"></i></span><div><small>${source.materials.length} 份材料</small><b>${escapeHtml(source.title)}</b><em>${source.count ? `${source.count} 个材料页/片段` : "材料页数未记录"}</em></div>`;
    const materialName = id => source.materials.find(material => material.id === (id || "primary"))?.title || "主材料";
    const pageKeys = new Set(source.pages.map(page => `${page.materialId}:${Number(page.number)}`));
    document.querySelector("#evidenceQuoteList").innerHTML = items.length ? `<div class="evidence-list-heading"><b>当前使用的原文证据</b><small>${items.length} 条</small></div>${items.map((item, evidenceIndex) => `<article class="evidence-quote"><span>${escapeHtml(materialName(item.materialId))} · ${item.slideNumber ? positionLabel(Number(item.slideNumber),item.materialId||"primary") : `片段 ${evidenceIndex + 1}`}${item.origin === "teacher" ? " · 教师补充" : ""}</span><blockquote>${escapeHtml(item.quote)}</blockquote>${pageKeys.has(`${item.materialId || "primary"}:${Number(item.slideNumber)}`) ? `<button class="text-button" type="button" data-source-context="${Number(item.slideNumber)}" data-material-id="${escapeHtml(item.materialId || "primary")}" data-evidence-index="${evidenceIndex}">查看页面上下文 →</button>` : ""}</article>`).join("")}` : '<div class="evidence-missing"><i class="ph ph-warning-circle"></i><div><b>这个知识点没有可核对的原文证据</b><p>它可能来自体验示例、旧版本或不完整的分析结果。请不要将其视为已经由材料支持的结论。</p></div></div>';
    const contextPanel = document.querySelector("#evidenceContextPanel");contextPanel.classList.add("hidden");contextPanel.innerHTML="";
    document.querySelectorAll("#evidenceQuoteList [data-source-context]").forEach(button => button.onclick = () => {const page=source.pages.find(item=>item.materialId===button.dataset.materialId&&Number(item.number)===Number(button.dataset.sourceContext)),evidence=items[Number(button.dataset.evidenceIndex)];if(!page)return;const parts=locateQuoteInContext(page.text,evidence?.quote);contextPanel.innerHTML=`<header><div><small>${escapeHtml(page.materialTitle)} · ${escapeHtml(materialRoleLabel(page.materialRole))}</small><h3>${positionLabel(page.number,page.materialId)} · ${escapeHtml(page.title||"材料上下文")}</h3></div><em>${parts.found?"已定位原句":"未在保存片段中找到完全一致的原句"}</em></header><p>${escapeHtml(parts.before)}${parts.found?`<mark>${escapeHtml(parts.match)}</mark>${escapeHtml(parts.after)}`:""}</p>`;contextPanel.classList.remove("hidden");contextPanel.scrollIntoView({block:"nearest"})});
    const editorRows = document.querySelector("#evidenceEditorRows");
    editorRows.replaceChildren(...(items.length ? items : [{ materialId: "primary" }]).map(item => evidenceRow(item, materialName(item.materialId))));
    document.querySelector(".evidence-editor").open = Boolean(options.edit || !items.length);
    const picker = document.querySelector("#evidenceCandidatePicker");
    const candidatePages = options.pageNumber ? source.pages.filter(page => Number(page.number) === Number(options.pageNumber) && (!options.materialId || page.materialId === options.materialId)) : source.pages;
    const candidates = buildEvidenceCandidates(candidatePages, `${point.title || ""} ${point.logic || point.coreLogic || point.explanation || ""}`).map(candidate => ({ ...candidate, selected: items.some(item => (item.materialId || "primary") === candidate.materialId && Number(item.slideNumber) === candidate.pageNumber && item.quote === candidate.quote) }));
    picker.classList.toggle("hidden", !candidates.length);
    picker.innerHTML = candidates.length ? `<header><div><b>${options.pageNumber ? `从${positionLabel(Number(options.pageNumber),options.materialId||"primary")}选取原句` : "从已保存页面选取原句"}</b><small>${options.pageNumber ? "只显示当前页面的真实文本" : "按当前知识点相关性排序"}；加入后仍需保存并人工核对</small></div><em>${candidates.length} 条候选</em></header><div>${candidates.map((candidate,index)=>`<button type="button" data-evidence-candidate="${index}" ${candidate.selected ? "disabled" : ""}><span>${escapeHtml(candidate.materialTitle)} · ${positionLabel(candidate.pageNumber,candidate.materialId)} · ${escapeHtml(candidate.pageTitle)}</span><q>${escapeHtml(candidate.quote)}</q><em>${candidate.selected ? "已在证据中" : "加入证据"}</em></button>`).join("")}</div>` : "";
    picker.querySelectorAll("[data-evidence-candidate]").forEach(button => button.onclick = () => {
      const candidate = candidates[Number(button.dataset.evidenceCandidate)];
      if (!candidate || candidate.selected) return;
      const blank = [...editorRows.querySelectorAll(".evidence-editor-row")].find(row => !row.querySelector("textarea").value.trim());
      const row = evidenceRow({ slideNumber: candidate.pageNumber, quote: candidate.quote, materialId: candidate.materialId }, candidate.materialTitle);
      if (blank) blank.replaceWith(row); else editorRows.append(row);
      document.querySelector(".evidence-editor").open = true;
      candidate.selected = true; button.disabled = true; button.querySelector(":scope > em").textContent = "已加入";
      row.scrollIntoView({ block: "nearest" });
    });
    const reviewState = document.querySelector("#evidenceReviewState");
    reviewState.textContent = reviewLabel(point);
    reviewState.className = point.evidenceReview?.status || "unreviewed";
    document.querySelector("#verifyEvidence").disabled = !items.length;
    dialog.showModal();
  }

  function saveReview(status) {
    const unit = ensureEditable();
    const point = unit?.keyPoints?.[activeIndex];
    if (!point) return;
    if (status === "verified" && !evidenceItems(point,unit).length) return showToast("没有有效原文证据，不能标记为已核对");
    point.evidenceReview = { status, reviewedAt: new Date().toISOString() };
    onSave(status === "verified" ? `核对知识证据：${point.title}` : `标记需复核：${point.title}`, status === "verified" ? "教师确认知识归纳未超出所列材料原文。" : "教师认为知识归纳或材料依据仍需进一步检查。");
    dialog.close();
    showToast(status === "verified" ? "已记录教师核对结果" : "已加入需复核清单");
  }
  document.querySelector("#verifyEvidence").onclick = () => saveReview("verified");
  document.querySelector("#markEvidenceReview").onclick = () => saveReview("needs-review");
  document.querySelector("#addEvidenceRow").onclick = () => document.querySelector("#evidenceEditorRows").append(evidenceRow({ materialId: "primary" }, "主材料"));
  document.querySelector("#saveEvidenceRows").onclick = () => {
    const unit = ensureEditable(), point = unit?.keyPoints?.[activeIndex];
    if (!point) return;
    const rows = [...document.querySelectorAll("#evidenceEditorRows .evidence-editor-row")].map(row => ({ slideNumber: row.querySelector("input").value, quote: row.querySelector("textarea").value, materialId: row.dataset.materialId, origin: "teacher" }));
    const evidence = normalizeEvidenceDraft(rows);
    if (!evidence.length) return showToast("请至少保留一条可核对的材料原文");
    point.evidence = evidence;
    point.evidenceReview = { status: "needs-review", reviewedAt: new Date().toISOString() };
    onSave(`修正知识证据：${point.title}`, `教师补充或修正 ${evidence.length} 条材料原文，原核对状态已失效。`);
    dialog.close();
    showToast("证据修改已保存，请重新核对知识归纳");
  };

  function decorate() {
    const panel = document.querySelector("#knowledgePanel");
    if (!panel || panel.querySelector(".evidence-coverage")) return;
    const unit = getUnit();
    const coverage = summarizeEvidenceCoverage(unit?.keyPoints || []);
    const source = sourceMeta(unit);
    const audit = document.createElement("section");
    audit.className = `evidence-coverage ${coverage.unsupported ? "has-gap" : "complete"}`;
    audit.innerHTML = `<div><span><i class="ph ph-quotes"></i></span><p><b>材料证据覆盖 ${coverage.supported}/${coverage.total}</b><small>${escapeHtml(source.label)} · ${escapeHtml(source.title)}${coverage.unsupported ? ` · ${coverage.unsupported} 个知识点缺少原文证据` : " · 所有知识点均可追溯"}</small></p></div><div><em>${coverage.reviewed} 已核对</em>${coverage.needsReview ? `<em class="warn">${coverage.needsReview} 需复核</em>` : ""}</div>`;
    panel.prepend(audit);
    panel.querySelectorAll(".knowledge-card").forEach((card, index) => {
      const point = unit?.keyPoints?.[index] || {};
      const items = evidenceItems(point,unit);
      const footer = document.createElement("footer");
      footer.className = "knowledge-evidence-footer";
      footer.innerHTML = `<span class="${items.length ? "supported" : "unsupported"}"><i class="ph ${items.length ? "ph-quotes" : "ph-warning-circle"}"></i>${items.length ? `${items.length} 条原文依据` : "缺少原文依据"}</span><button type="button">查看来源</button>`;
      footer.querySelector("button").onclick = () => open(index);
      card.querySelector(":scope > div")?.append(footer);
    });
  }

  const observer = new MutationObserver(() => {
    if (!document.querySelector("#knowledgePanel .evidence-coverage")) queueMicrotask(decorate);
  });
  observer.observe(document.querySelector("#knowledgePanel"), { childList: true });
  decorate();
  return { open, decorate };
}
