function text(value = "") { return String(value || "").trim(); }
function esc(value = "") { return text(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])); }

function hash(value) {
  let result = 2166136261;
  for (const char of text(value)) { result ^= char.codePointAt(0); result = Math.imul(result, 16777619); }
  return (result >>> 0).toString(36);
}

function tokens(value) {
  const source = text(value).toLowerCase(), result = new Set(source.match(/[a-z][a-z0-9_+-]{1,}|\d+(?:\.\d+)?/g) || []);
  for (const segment of source.match(/[\u3400-\u9fff]{2,}/g) || []) for (let index = 0; index < segment.length - 1; index += 1) result.add(segment.slice(index, index + 2));
  return result;
}

function similarity(left, right) {
  const a = tokens(left), b = tokens(right);
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  a.forEach(token => { if (b.has(token)) overlap += 1; });
  return overlap / Math.sqrt(a.size * b.size);
}

export function alignmentRef(kind, item, index = 0) {
  const explicit = text(item?.id);
  if (explicit) return `${kind}:id:${explicit}`;
  const identifying = kind === "knowledge" ? `${item?.title}|${item?.logic || item?.coreLogic}` : kind === "activity" ? `${item?.phase}|${item?.teacherAction}|${item?.studentAction}` : `${item?.prompt || item?.question}|${item?.answerCue || item?.purpose}`;
  return `${kind}:text:${hash(identifying || index)}`;
}

export function objectiveRef(objective) { return `objective:${hash(objective)}`; }

export function alignmentEntities(unit = {}) {
  return {
    knowledge: (unit.keyPoints || []).map((item, index) => ({ ref: alignmentRef("knowledge", item, index), id: text(item.id), label: text(item.title) || `知识点 ${index + 1}`, content: [item.title, item.logic, item.coreLogic, item.misconception].map(text).join(" "), evidenceReady: item.evidenceReview?.status === "verified" && (item.evidence || []).some(entry => text(entry?.quote)) })),
    activities: (unit.lesson?.flow || []).map((item, index) => ({ ref: alignmentRef("activity", item, index), label: text(item.phase) || `课堂环节 ${index + 1}`, content: [item.phase, item.teacherAction, item.studentAction, item.studentOutput, item.feedback].map(text).join(" "), studentOutput: text(item.studentOutput), feedback: text(item.feedback), keyPointIds: Array.isArray(item.keyPointIds) ? item.keyPointIds.map(text) : [] })),
    questions: (unit.lesson?.questions || []).map((item, index) => ({ ref: alignmentRef("question", item, index), label: text(item.prompt || item.question) || `诊断问题 ${index + 1}`, content: [item.prompt, item.question, item.answerCue, item.purpose, item.misconception].map(text).join(" "), keyPointIds: Array.isArray(item.keyPointIds) ? item.keyPointIds.map(text) : [] })),
  };
}

function validRefs(values, entities) {
  const allowed = new Set(entities.map(item => item.ref));
  return [...new Set(Array.isArray(values) ? values.filter(value => allowed.has(value)) : [])];
}
function alignmentSignature(entities){return JSON.stringify([entities.knowledge,entities.activities,entities.questions].map(items=>items.map(({ref,content})=>({ref,content}))));}

function suggest(objective, entities, selectedKnowledgeIds = []) {
  const ranked = entities.map(item => ({ item, score: similarity(objective, item.content) })).filter(entry => entry.score > 0).sort((a, b) => b.score - a.score);
  const direct = ranked.filter((entry, index) => entry.score >= 0.12 || index === 0 && entry.score >= 0.07).slice(0, 2).map(entry => entry.item.ref);
  if (!selectedKnowledgeIds.length) return direct;
  const selectedIds = new Set(selectedKnowledgeIds.filter(Boolean));
  const linked = entities.filter(item => item.keyPointIds?.some(id => selectedIds.has(id))).map(item => item.ref);
  return [...new Set([...linked, ...direct])].slice(0, 3);
}

export function buildTeachingAlignment(unit = {}) {
  const entities = alignmentEntities(unit), saved = new Map((unit.teachingAlignment || []).filter(Boolean).map(row => [row.objectiveRef, row]));
  const rows = (unit.objectives || []).map((objective, index) => {
    const ref = objectiveRef(objective), existing = saved.get(ref), knowledgeRefs = existing ? validRefs(existing.knowledgeRefs, entities.knowledge) : suggest(objective, entities.knowledge);
    const knowledgeIds = knowledgeRefs.map(value => entities.knowledge.find(item => item.ref === value)?.id).filter(Boolean);
    const activityRefs = existing ? validRefs(existing.activityRefs, entities.activities) : suggest(objective, entities.activities, knowledgeIds);
    const questionRefs = existing ? validRefs(existing.questionRefs, entities.questions) : suggest(objective, entities.questions, knowledgeIds);
    const supported = knowledgeRefs.filter(value => entities.knowledge.find(item => item.ref === value)?.evidenceReady).length;
    const gaps = [];
    if (!knowledgeRefs.length) gaps.push("未关联知识点");
    else if (!supported) gaps.push("知识点缺少已核对原文");
    if (!activityRefs.length) gaps.push("缺少课堂活动");
    if (!questionRefs.length) gaps.push("缺少诊断问题");
    return { objective: text(objective), objectiveRef: ref, index, confirmed: Boolean(existing&&existing.contentSignature===alignmentSignature(entities)), knowledgeRefs, activityRefs, questionRefs, supportedKnowledge: supported, gaps, structuralComplete: Boolean(knowledgeRefs.length && activityRefs.length && questionRefs.length), complete: !gaps.length };
  });
  const activityRows = entities.activities.map((activity, index) => {
    const linkedObjectives = rows.filter(row => row.activityRefs.includes(activity.ref));
    const questionRefs = [...new Set(linkedObjectives.flatMap(row => row.questionRefs))];
    const gaps = [];
    if (!linkedObjectives.length) gaps.push("未关联学习目标");
    if (linkedObjectives.length && !questionRefs.length) gaps.push("缺少诊断闭环");
    return { ...activity, index, objectiveRefs: linkedObjectives.map(row => row.objectiveRef), objectiveLabels: linkedObjectives.map(row => row.objective), questionRefs, confirmed: linkedObjectives.some(row => row.confirmed), gaps, structuralComplete: Boolean(linkedObjectives.length && questionRefs.length) };
  });
  return { entities, rows, activityRows, structuralComplete: rows.filter(row => row.structuralComplete).length, complete: rows.filter(row => row.complete).length, confirmed: rows.filter(row => row.confirmed).length, total: rows.length, gaps: rows.reduce((sum, row) => sum + row.gaps.length, 0), activityStructuralComplete: activityRows.filter(row => row.structuralComplete).length, activityConfirmed: activityRows.filter(row => row.confirmed).length, activityTotal: activityRows.length, activityGaps: activityRows.reduce((sum, row) => sum + row.gaps.length, 0) };
}

export function alignmentFromSelections(unit, selections = []) {
  const report = buildTeachingAlignment(unit), objectiveRefs = new Set(report.rows.map(row => row.objectiveRef));
  return selections.filter(row => objectiveRefs.has(row.objectiveRef)).map(row => ({ objectiveRef: row.objectiveRef, knowledgeRefs: validRefs(row.knowledgeRefs, report.entities.knowledge), activityRefs: validRefs(row.activityRefs, report.entities.activities), questionRefs: validRefs(row.questionRefs, report.entities.questions), contentSignature:alignmentSignature(report.entities), confirmedAt: new Date().toISOString() }));
}

function labelList(refs, entities) {
  const items=refs.map(ref=>entities.find(item=>item.ref===ref)).filter(Boolean);
  return items.length?items.map(item=>`<button type="button" class="alignment-detail-link" data-alignment-detail="${esc(item.ref)}" title="查看完整内容">${esc(item.label)}</button>`).join(''):'<em>未关联</em>';
}

export function createTeachingAlignmentInspector({ getUnit, ensureEditable, onSave, showToast } = {}) {
  const style = document.createElement("link"); style.rel = "stylesheet"; style.href = "./teaching-alignment.css"; document.head.append(style);
  document.body.insertAdjacentHTML("beforeend", `<dialog class="create-dialog" id="alignmentDialog"><div class="dialog-shell alignment-shell"><header><div><span class="section-kicker">CONSTRUCTIVE ALIGNMENT</span><h2>校正教学对齐关系</h2><p>逐个目标确认它由哪些知识、课堂活动和诊断问题支撑。</p></div><button class="dialog-close" id="closeAlignment" type="button" aria-label="关闭"><i class="ph ph-x"></i></button></header><div class="dialog-body" id="alignmentEditor"></div><footer><span>保存只修改关联，不改写原教学内容。</span><div><button class="button ghost" id="cancelAlignment" type="button">取消</button><button class="button dark" id="saveAlignment" type="button">保存对齐关系</button></div></footer></div></dialog>`);
  const dialog = document.querySelector("#alignmentDialog"), editor = document.querySelector("#alignmentEditor");
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-alignment-detail]');if(!button)return;
    const unit=getUnit(),entities=alignmentEntities(unit),ref=button.dataset.alignmentDetail;
    const kind=Object.keys(entities).find(k=>entities[k].some(x=>x.ref===ref));if(!kind)return;
    const index=entities[kind].findIndex(x=>x.ref===ref),item=entities[kind][index];
    const detail=document.createElement('dialog');detail.className='alignment-content-dialog';
    const header=document.createElement('h2');header.textContent=kind==='questions'?'诊断问题':kind==='activities'?'课堂活动':'知识与依据';detail.append(header);
    const content=document.createElement('div');content.className='alignment-full-content';content.textContent=kind==='questions'?item.label:item.content;detail.append(content);
    if(kind==='questions'){const q=unit.lesson.questions[index];for(const [label,value]of [['判断依据',q.answerCue||q.purpose],['常见误解',q.misconception]]){const d=document.createElement('details'),s=document.createElement('summary'),p=document.createElement('p');s.textContent=label;p.textContent=value||'尚未补充';d.append(s,p);detail.append(d);}}
    const footer=document.createElement('footer'),close=document.createElement('button'),edit=document.createElement('button');close.textContent='关闭';close.onclick=()=>detail.close();edit.textContent='编辑内容';edit.onclick=()=>{detail.close();document.dispatchEvent(new CustomEvent('edit-unit-section',{detail:kind==='questions'?'assessment':kind==='activities'?'lesson':'knowledge'}));};footer.append(edit,close);detail.append(footer);detail.onclose=()=>detail.remove();document.body.append(detail);detail.showModal();
  });

  function renderPanel() {
    const panel = document.querySelector("#overviewPanel"); if (!panel) return;
    panel.querySelector(".teaching-alignment-panel")?.remove();
    const report = buildTeachingAlignment(getUnit());
    const markup = report.total ? `<section class="teaching-alignment-panel"><header><div><span class="section-kicker">TEACHING ALIGNMENT</span><h2>教学目标对齐检查</h2></div><div class="alignment-score"><b>${report.complete}/${report.total}</b><small>条目标链完整</small></div></header><div class="alignment-rows">${report.rows.map(row => `<article class="alignment-row ${row.complete ? "complete" : "gap"}"><div class="alignment-objective"><small>目标 ${String(row.index + 1).padStart(2, "0")} · ${row.confirmed ? "教师已确认" : "系统建议待确认"}</small><h3>${esc(row.objective)}</h3>${row.gaps.length ? `<p>${row.gaps.map(esc).join(" · ")}</p>` : "<p>知识、活动和诊断链完整</p>"}</div><div class="alignment-chain"><div><b>知识与依据</b>${labelList(row.knowledgeRefs, report.entities.knowledge)}</div><i class="ph ph-arrow-right"></i><div><b>课堂活动</b>${labelList(row.activityRefs, report.entities.activities)}</div><i class="ph ph-arrow-right"></i><div><b>诊断问题</b>${labelList(row.questionRefs, report.entities.questions)}</div></div></article>`).join("")}</div><section class="activity-chain-audit"><header><div><small>ACTIVITY TRACEABILITY</small><h3>课堂活动反向检查</h3></div><b>${report.activityStructuralComplete}/${report.activityTotal}</b></header><div>${report.activityRows.map(row => `<article class="${row.structuralComplete ? "complete" : "gap"}"><span>${String(row.index + 1).padStart(2, "0")}</span><div><h4>${esc(row.label)}</h4><p>${row.gaps.length ? row.gaps.map(esc).join(" · ") : `${row.confirmed ? "教师已确认" : "系统建议待确认"}：${row.objectiveLabels.map(esc).join("、")}`}</p></div><div><small>服务目标</small>${row.objectiveLabels.length ? row.objectiveLabels.map(label => `<em>${esc(label)}</em>`).join("") : "<em>未关联</em>"}</div><i class="ph ph-arrow-right"></i><div><small>诊断验证</small>${labelList(row.questionRefs, report.entities.questions)}</div></article>`).join("")}</div></section><footer><span>${report.confirmed}/${report.total} 项目标已确认 · ${report.activityStructuralComplete}/${report.activityTotal} 项活动进入诊断闭环 · ${report.gaps + report.activityGaps} 个缺口</span><button class="button outline" type="button" data-edit-alignment><i class="ph ph-link"></i> 校正对齐关系</button></footer></section>` : `<section class="teaching-alignment-panel empty"><h2>先建立可评价的学习目标</h2><p>有了学习目标后，这里会检查知识依据、课堂活动和诊断问题是否形成闭环。</p></section>`;
    panel.insertAdjacentHTML("beforeend", markup);
    panel.querySelectorAll(".activity-chain-audit article.complete p").forEach(item => { item.textContent = "已形成目标—活动—诊断闭环"; });
    panel.querySelector("[data-edit-alignment]")?.addEventListener("click", open);
  }

  function checkboxGroup(title, kind, items, selected) {
    return `<section><h4>${title}</h4><div class="alignment-options">${items.length ? items.map(item => `<label><input type="checkbox" data-align-kind="${kind}" value="${esc(item.ref)}" ${selected.includes(item.ref) ? "checked" : ""}><span>${esc(item.label)}${kind === "knowledge" ? `<small>${item.evidenceReady ? "有已核对原文" : "原文待核对"}</small>` : ""}</span></label>`).join("") : `<p>当前没有可关联的${title}。</p>`}</div></section>`;
  }

  function open() {
    const unit = ensureEditable(), report = buildTeachingAlignment(unit);
    if (!report.total) { showToast("请先在教学概览中添加学习目标"); return; }
    editor.innerHTML = report.rows.map(row => `<article class="alignment-edit-row" data-objective-ref="${esc(row.objectiveRef)}"><header><small>学习目标 ${String(row.index + 1).padStart(2, "0")}</small><h3>${esc(row.objective)}</h3><span>${row.confirmed ? "当前为教师确认关系" : "已载入系统建议，请核对后保存"}</span></header><div class="alignment-edit-grid">${checkboxGroup("知识点", "knowledge", report.entities.knowledge, row.knowledgeRefs)}${checkboxGroup("课堂活动", "activity", report.entities.activities, row.activityRefs)}${checkboxGroup("诊断问题", "question", report.entities.questions, row.questionRefs)}</div></article>`).join("");
    dialog.showModal();
  }

  document.querySelector("#closeAlignment").onclick = document.querySelector("#cancelAlignment").onclick = () => dialog.close();
  document.querySelector("#saveAlignment").onclick = () => {
    const unit = getUnit(), selections = [...editor.querySelectorAll("[data-objective-ref]")].map(row => ({ objectiveRef: row.dataset.objectiveRef, knowledgeRefs: [...row.querySelectorAll('[data-align-kind="knowledge"]:checked')].map(input => input.value), activityRefs: [...row.querySelectorAll('[data-align-kind="activity"]:checked')].map(input => input.value), questionRefs: [...row.querySelectorAll('[data-align-kind="question"]:checked')].map(input => input.value) }));
    unit.teachingAlignment = alignmentFromSelections(unit, selections);
    const report = buildTeachingAlignment(unit);
    onSave?.("校正教学对齐关系", `${report.confirmed} 项学习目标已确认；当前仍有 ${report.gaps + report.activityGaps} 个对齐缺口。`);
    dialog.close(); renderPanel(); showToast(report.gaps + report.activityGaps ? `对齐关系已保存，仍有 ${report.gaps + report.activityGaps} 个缺口` : "教学目标、课堂活动和诊断问题已形成完整闭环");
  };
  return { render: renderPanel, open, report: () => buildTeachingAlignment(getUnit()) };
}
