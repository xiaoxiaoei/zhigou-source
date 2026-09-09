const sectionMeta = {
  knowledge: { title: "编辑知识与难点", description: "逐项完善知识逻辑、常见误解和诊断提问。", versionTitle: "更新知识与难点" },
  lesson: { title: "编辑课堂流程", description: "把课堂组织为可执行的教师活动、学生活动和时间安排。", versionTitle: "更新课堂流程" },
  assessment: { title: "编辑互动与评价", description: "用诊断问题和课后证据判断学生是否真正理解。", versionTitle: "更新互动与评价" },
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function field(labelText, value = "", { multiline = false, type = "text", min } = {}) {
  const label = element("label", "structured-field");
  label.append(element("span", "", labelText));
  const input = document.createElement(multiline ? "textarea" : "input");
  if (!multiline) input.type = type;
  if (min != null) input.min = String(min);
  if (multiline) input.rows = 3;
  input.value = value == null ? "" : String(value);
  label.append(input);
  return { label, input };
}

function itemHeader(index, itemLabel) {
  const header = element("header", "structured-item-header");
  header.append(element("b", "", `${itemLabel} ${String(index + 1).padStart(2, "0")}`));
  const actions = element("div", "structured-item-actions");
  for (const [action, icon, title] of [["up", "ph-arrow-up", "上移"], ["down", "ph-arrow-down", "下移"], ["remove", "ph-trash", "移除"]]) {
    const button = element("button");
    button.type = "button";
    button.dataset.itemAction = action;
    button.dataset.index = String(index);
    button.title = title;
    button.setAttribute("aria-label", title);
    button.innerHTML = `<i class="ph ${icon}"></i>`;
    actions.append(button);
  }
  header.append(actions);
  return header;
}

function normalizePoint(point = {}) {
  return { ...point, title: point.title || "", logic: point.logic || point.coreLogic || point.explanation || "", misconception: point.misconception || point.commonMisconception || "", question: point.question || point.teachingQuestion || "" };
}

function normalizeFlow(step = {}) {
  return { ...step, phase: step.phase || "", minutes: Number(step.minutes || 10), teacherAction: step.teacherAction || "", studentAction: step.studentAction || "", studentOutput: step.studentOutput || "", feedback: step.feedback || "" };
}

function normalizeQuestion(question = {}) {
  return { ...question, prompt: question.prompt || question.question || "", answerCue: question.answerCue || question.purpose || "", misconception: question.misconception || "", keyPointIds: Array.isArray(question.keyPointIds) ? [...new Set(question.keyPointIds.map(String).filter(Boolean))] : [] };
}

export function moveItem(items, index, direction) {
  const target = index + direction;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return items;
  const copy = [...items];
  [copy[index], copy[target]] = [copy[target], copy[index]];
  return copy;
}

export function createUnitContentEditor({ getUnit, ensureEditable, onSave, showToast, storage = globalThis.localStorage, storageKey = "zhigou-unit-editor-drafts-v1" }) {
  const style = document.createElement("link");
  style.rel = "stylesheet";
  style.href = "/unit-content-editor.css";
  document.head.append(style);
  document.body.insertAdjacentHTML("beforeend", `<dialog class="create-dialog" id="structuredEditorDialog"><form method="dialog" class="dialog-shell structured-editor"><header><div><span class="section-kicker">STRUCTURED EDITOR</span><h2 id="structuredEditorTitle"></h2><p id="structuredEditorDescription"></p><div class="editor-draft-status" id="structuredDraftStatus"><i class="ph ph-cloud-check"></i><span>输入内容会自动保存在本机</span><button class="hidden" id="discardStructuredDraft" type="button">放弃恢复的草稿</button></div></div><button class="dialog-close" value="cancel" aria-label="稍后继续"><i class="ph ph-x"></i></button></header><div class="structured-editor-body"><div id="structuredEditorContent"></div><div class="dialog-error hidden" id="structuredEditorError"><i class="ph ph-warning-circle"></i><span></span></div></div><footer><span id="structuredEditorCount"></span><div><button class="button ghost" value="cancel">稍后继续</button><button class="button dark" id="structuredEditorSave" type="button">保存新版本</button></div></footer></form></dialog>`);

  const dialog = document.querySelector("#structuredEditorDialog");
  const content = document.querySelector("#structuredEditorContent");
  const error = document.querySelector("#structuredEditorError");
  let section = "knowledge";
  let working = null;
  let draftContext = null;
  let restoredDraft = false;

  function draftStatus(message = "草稿已自动保存到本机", canDiscard = restoredDraft) {
    document.querySelector("#structuredDraftStatus span").textContent = message;
    document.querySelector("#discardStructuredDraft").classList.toggle("hidden", !canDiscard);
  }

  function saveDraft() {
    if (!draftContext || !dialog.open) return;
    const draft = createUnitEditorDraft(draftContext, working);
    if (writeUnitEditorDraft(storage, storageKey, draft)) draftStatus();
  }

  function showError(message) {
    error.querySelector("span").textContent = message;
    error.classList.remove("hidden");
  }

  function renderKnowledge() {
    content.innerHTML = "";
    const list = element("div", "structured-list");
    working.forEach((point, index) => {
      const card = element("article", "structured-item");
      card.append(itemHeader(index, "知识点"));
      const title = field("知识点名称", point.title);
      const logic = field("核心逻辑", point.logic, { multiline: true });
      const misconception = field("常见误解", point.misconception, { multiline: true });
      const question = field("诊断提问", point.question, { multiline: true });
      title.input.oninput = () => { point.title = title.input.value; saveDraft(); };
      logic.input.oninput = () => { point.logic = logic.input.value; saveDraft(); };
      misconception.input.oninput = () => { point.misconception = misconception.input.value; saveDraft(); };
      question.input.oninput = () => { point.question = question.input.value; saveDraft(); };
      card.append(title.label, logic.label, misconception.label, question.label);
      list.append(card);
    });
    content.append(list, addButton("添加知识点", "knowledge"));
    document.querySelector("#structuredEditorCount").textContent = `${working.length} 个知识点`;
  }

  function renderLesson() {
    content.innerHTML = "";
    const list = element("div", "structured-list");
    working.forEach((step, index) => {
      const card = element("article", "structured-item");
      card.append(itemHeader(index, "课堂环节"));
      const row = element("div", "structured-fields-two");
      const phase = field("环节名称", step.phase);
      const minutes = field("时间（分钟）", step.minutes, { type: "number", min: 1 });
      row.append(phase.label, minutes.label);
      const teacher = field("教师活动", step.teacherAction, { multiline: true });
      const student = field("学生活动", step.studentAction, { multiline: true });
      const output = field("学生可观察产出", step.studentOutput, { multiline: true });
      const feedback = field("教师形成性反馈", step.feedback, { multiline: true });
      phase.input.oninput = () => { step.phase = phase.input.value; saveDraft(); };
      minutes.input.oninput = () => { step.minutes = Number(minutes.input.value || 0); saveDraft(); };
      teacher.input.oninput = () => { step.teacherAction = teacher.input.value; saveDraft(); };
      student.input.oninput = () => { step.studentAction = student.input.value; saveDraft(); };
      output.input.oninput = () => { step.studentOutput = output.input.value; saveDraft(); };
      feedback.input.oninput = () => { step.feedback = feedback.input.value; saveDraft(); };
      card.append(row, teacher.label, student.label, output.label, feedback.label);
      list.append(card);
    });
    content.append(list, addButton("添加课堂环节", "lesson"));
    const total = working.reduce((sum, step) => sum + Number(step.minutes || 0), 0);
    const expected = Number.parseInt(getUnit()?.duration, 10);
    const difference = Number.isFinite(expected) && expected !== total ? ` · 与单元时长相差 ${Math.abs(total - expected)} 分钟` : "";
    const count = document.querySelector("#structuredEditorCount");
    count.textContent = `${working.length} 个环节 · 共 ${total} 分钟${difference}`;
    count.classList.toggle("has-warning", Boolean(difference));
  }

  function renderAssessment() {
    content.innerHTML = "";
    const heading = element("div", "structured-subheading");
    heading.append(element("h3", "", "课堂诊断问题"), element("p", "", "每个问题都应能暴露一种具体误解。"));
    content.append(heading);
    const list = element("div", "structured-list");
    working.questions.forEach((question, index) => {
      const card = element("article", "structured-item");
      const header = itemHeader(index, "诊断问题");
      header.querySelectorAll("button").forEach(button => button.dataset.list = "questions");
      card.append(header);
      const prompt = field("问题", question.prompt, { multiline: true });
      const answer = field("判断依据 / 预期答案", question.answerCue, { multiline: true });
      const misconception = field("错误答案反映的误解", question.misconception, { multiline: true });
      prompt.input.oninput = () => { question.prompt = prompt.input.value; saveDraft(); };
      answer.input.oninput = () => { question.answerCue = answer.input.value; saveDraft(); };
      misconception.input.oninput = () => { question.misconception = misconception.input.value; saveDraft(); };
      const links = element("fieldset", "structured-link-field");
      links.append(element("legend", "", "关联知识点（用于题组覆盖检查）"));
      const points = getUnit()?.keyPoints || [];
      if (points.length) {
        const options = element("div", "structured-link-options");
        points.forEach((point, pointIndex) => {
          const id = String(point.id || `kp-${pointIndex + 1}`), label = element("label");
          const input = document.createElement("input"); input.type = "checkbox"; input.value = id; input.checked = question.keyPointIds.includes(id);
          input.onchange = () => { question.keyPointIds = [...options.querySelectorAll('input:checked')].map(item => item.value); saveDraft(); };
          label.append(input, element("span", "", point.title || `知识点 ${pointIndex + 1}`)); options.append(label);
        });
        links.append(options);
      } else links.append(element("p", "", "当前没有可关联的知识点。"));
      card.append(prompt.label, answer.label, misconception.label, links);
      list.append(card);
    });
    content.append(list, addButton("添加诊断问题", "questions"));
    const evidenceHeading = element("div", "structured-subheading");
    evidenceHeading.append(element("h3", "", "课后证据与下次调整"), element("p", "", "记录授课后要收集什么证据。"));
    content.append(evidenceHeading);
    const evidenceList = element("div", "evidence-list");
    working.afterClass.forEach((value, index) => {
      const row = element("div", "evidence-row");
      const input = document.createElement("textarea");
      input.rows = 2;
      input.value = value;
      input.oninput = () => { working.afterClass[index] = input.value; saveDraft(); };
      const remove = element("button", "", "移除");
      remove.type = "button";
      remove.dataset.removeEvidence = String(index);
      row.append(input, remove);
      evidenceList.append(row);
    });
    content.append(evidenceList, addButton("添加课后证据", "afterClass"));
    document.querySelector("#structuredEditorCount").textContent = `${working.questions.length} 个诊断问题 · ${working.afterClass.length} 项课后证据`;
  }

  function addButton(label, list) {
    const button = element("button", "structured-add", `＋ ${label}`);
    button.type = "button";
    button.dataset.addItem = list;
    return button;
  }

  function render() {
    error.classList.add("hidden");
    if (section === "knowledge") renderKnowledge();
    else if (section === "lesson") renderLesson();
    else renderAssessment();
  }

  function loadWorking(unit) {
    if (section === "knowledge") working = (unit.keyPoints || []).map(normalizePoint);
    else if (section === "lesson") working = (unit.lesson?.flow || []).map(normalizeFlow);
    else working = { questions: (unit.lesson?.questions || []).map(normalizeQuestion), afterClass: [...(unit.lesson?.afterClass || [])] };
  }

  function open(nextSection) {
    const unit = ensureEditable();
    section = nextSection;
    loadWorking(unit);
    draftContext = { unitId: unit.id, section, baseline: unitSectionFingerprint(unit, section) };
    const draft = readUnitEditorDraft(storage, storageKey, draftContext);
    restoredDraft = Boolean(draft);
    if (draft) working = draft.value;
    document.querySelector("#structuredEditorTitle").textContent = sectionMeta[section].title;
    document.querySelector("#structuredEditorDescription").textContent = sectionMeta[section].description;
    document.querySelector("#structuredEditorDescription").hidden = true;
    draftStatus(draft ? `已恢复 ${new Date(draft.updatedAt).toLocaleString("zh-CN")} 的本机草稿` : "输入内容会自动保存在本机", Boolean(draft));
    render();
    dialog.showModal();
  }

  content.addEventListener("click", event => {
    const add = event.target.closest("[data-add-item]");
    if (add) {
      if (add.dataset.addItem === "knowledge") working.push(normalizePoint());
      else if (add.dataset.addItem === "lesson") working.push(normalizeFlow());
      else if (add.dataset.addItem === "questions") working.questions.push(normalizeQuestion());
      else working.afterClass.push("");
      render();
      saveDraft();
      return;
    }
    const evidence = event.target.closest("[data-remove-evidence]");
    if (evidence) {
      working.afterClass.splice(Number(evidence.dataset.removeEvidence), 1);
      render();
      saveDraft();
      return;
    }
    const action = event.target.closest("[data-item-action]");
    if (!action) return;
    const list = section === "assessment" ? working.questions : working;
    const index = Number(action.dataset.index);
    if (action.dataset.itemAction === "remove") list.splice(index, 1);
    else {
      const moved = moveItem(list, index, action.dataset.itemAction === "up" ? -1 : 1);
      if (section === "assessment") working.questions = moved;
      else working = moved;
    }
    render();
    saveDraft();
  });

  document.querySelector("#discardStructuredDraft").onclick = () => {
    if (!draftContext) return;
    removeUnitEditorDraft(storage, storageKey, draftContext);
    loadWorking(getUnit());
    restoredDraft = false;
    draftStatus("已放弃本机草稿，恢复为当前已保存版本", false);
    render();
    showToast("本机编辑草稿已放弃");
  };

  document.querySelector("#structuredEditorSave").onclick = () => {
    const unit = getUnit();
    if (section === "knowledge") {
      working = working.map(normalizePoint);
      if (!working.length) return showError("请至少保留一个知识点。");
      if (working.some(point => !point.title.trim() || !point.logic.trim())) return showError("每个知识点都需要名称和核心逻辑。");
      unit.keyPoints = working.map(point => ({ ...point, title: point.title.trim(), logic: point.logic.trim(), misconception: point.misconception.trim(), question: point.question.trim() }));
      onSave(sectionMeta[section].versionTitle, `当前共 ${unit.keyPoints.length} 个知识点。`);
    } else if (section === "lesson") {
      working = working.map(normalizeFlow);
      if (!working.length) return showError("请至少保留一个课堂环节。");
      if (working.some(step => !step.phase.trim() || !step.teacherAction.trim() || !step.studentAction.trim() || !step.studentOutput.trim() || !step.feedback.trim() || step.minutes < 1)) return showError("每个课堂环节都需要名称、时间、师生活动、学生可观察产出和教师形成性反馈。");
      unit.lesson.flow = working.map(step => ({ ...step, phase: step.phase.trim(), teacherAction: step.teacherAction.trim(), studentAction: step.studentAction.trim(), studentOutput: step.studentOutput.trim(), feedback: step.feedback.trim() }));
      const total = unit.lesson.flow.reduce((sum, step) => sum + Number(step.minutes), 0);
      onSave(sectionMeta[section].versionTitle, `当前共 ${unit.lesson.flow.length} 个环节、${total} 分钟。`);
    } else {
      working.questions = working.questions.map(normalizeQuestion);
      if (!working.questions.length) return showError("请至少保留一个诊断问题。");
      if (working.questions.some(question => !question.prompt.trim())) return showError("每个诊断问题都需要填写问题内容。");
      unit.lesson.questions = working.questions.map(question => ({ ...question, prompt: question.prompt.trim(), answerCue: question.answerCue.trim(), misconception: question.misconception.trim() }));
      unit.lesson.afterClass = working.afterClass.map(item => item.trim()).filter(Boolean);
      onSave(sectionMeta[section].versionTitle, `当前共 ${unit.lesson.questions.length} 个诊断问题、${unit.lesson.afterClass.length} 项课后证据。`);
    }
    removeUnitEditorDraft(storage, storageKey, draftContext);
    restoredDraft = false;
    dialog.close();
    showToast("修改已保存为新版本");
  };

  function ensureToolbar(panelId, label, targetSection) {
    const panel = document.querySelector(panelId);
    if (!panel || panel.querySelector(`.section-edit-toolbar[data-section="${targetSection}"]`)) return;
    const toolbar = element("div", "section-edit-toolbar");
    toolbar.dataset.section = targetSection;
    toolbar.append(element("span", "", label));
    const button = element("button", "button outline", "编辑本节");
    button.type = "button";
    button.innerHTML = '<i class="ph ph-pencil-simple"></i> 编辑本节';
    button.onclick = () => open(targetSection);
    toolbar.append(button);
    panel.prepend(toolbar);
  }

  function ensureToolbars() {
    ensureToolbar("#knowledgePanel", "知识点、难点与误解", "knowledge");
    ensureToolbar("#lessonPanel", "课堂环节与活动", "lesson");
    ensureToolbar("#assessmentPanel", "诊断问题与课后证据", "assessment");
  }
  const observer = new MutationObserver(() => queueMicrotask(ensureToolbars));
  ["#knowledgePanel", "#lessonPanel", "#assessmentPanel"].forEach(selector => observer.observe(document.querySelector(selector), { childList: true }));
  ensureToolbars();
  return { open };
}
import {createUnitEditorDraft,readUnitEditorDraft,removeUnitEditorDraft,unitSectionFingerprint,writeUnitEditorDraft} from "./unit-editor-drafts.js";
