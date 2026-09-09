const esc = (value = "") => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

export function hasPossiblyTruncatedContent(question = {}) {
  return [question.prompt, question.answerCue, question.misconception].some(value => /(?:…|\.{3})\s*$/.test(String(value || "")));
}

export function normalizeDiagnosticQuestions(questions = []) {
  return (Array.isArray(questions) ? questions : []).map((question, index) => ({
    id: question?.id || `question-${index + 1}`,
    prompt: String(question?.prompt || question?.question || "").trim(),
    answerCue: String(question?.answerCue || question?.purpose || "").trim(),
    misconception: String(question?.misconception || "").trim(),
  })).filter(question => question.prompt);
}

export function createDiagnosticRun(questions = [], options = {}) {
  const normalized = normalizeDiagnosticQuestions(questions), createdAt = options.now || new Date().toISOString();
  return {
    id: options.id || `diagnostic-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt, completedAt: "", status: "running",
    observations: normalized.map(question => ({ questionId: question.id, prompt: question.prompt, answerCue: question.answerCue, misconception: question.misconception, result: "unobserved", note: "" })),
  };
}

export function summarizeDiagnosticRun(run = {}) {
  const observations = Array.isArray(run.observations) ? run.observations : [];
  const understood = observations.filter(item => item.result === "understood").length;
  const confused = observations.filter(item => item.result === "confused").length;
  const incomplete = observations.filter(item => item.result === "incomplete").length;
  return { total: observations.length, understood, confused, incomplete, unobserved: Math.max(0, observations.length - understood - confused - incomplete) };
}

export function diagnosticFollowUps(run = {}) {
  return (run.observations || []).filter(item => item.result === "confused" || item.result === "incomplete").map((item, index) => ({
    id: `${run.id}-${item.questionId || index}`,
    adjustment: item.result === "confused" ? `重新设计诊断与讲解：${item.prompt}` : `补做课堂诊断：${item.prompt}`,
    evidence: item.note || (item.result === "confused" ? "课堂观察到学生仍存在误解" : "课堂中未能完成诊断"),
    issue: item.misconception || "需要根据课堂表现进一步判断",
  }));
}

export function diagnosticQuestionSignature(questions = []) {
  return normalizeDiagnosticQuestions(questions).map(question => `${question.id}\u241f${question.prompt}\u241f${question.answerCue}\u241f${question.misconception}`).join("\u241e");
}

export function createDiagnosticCheckpoint(unitId = "", questions = [], run = {}, index = 0, revealed = [], now = new Date().toISOString()) {
  return { version:1, unitId:String(unitId || ""), signature:diagnosticQuestionSignature(questions), run:structuredClone(run), index:Math.max(0,Math.min((run.observations?.length||1)-1,Math.trunc(Number(index)||0))), revealed:structuredClone(revealed), updatedAt:now };
}

export function validateDiagnosticCheckpoint(checkpoint, unit = {}, options = {}) {
  if (!checkpoint || checkpoint.version !== 1 || !checkpoint.unitId || checkpoint.unitId !== String(unit.id || "")) return { valid:false, reason:"unit" };
  if (!checkpoint.run || checkpoint.run.status !== "running" || !Array.isArray(checkpoint.run.observations) || !checkpoint.run.observations.length) return { valid:false, reason:"state" };
  if (checkpoint.signature !== diagnosticQuestionSignature(unit.lesson?.questions || [])) return { valid:false, reason:"questions" };
  const maxAgeMs = Number(options.maxAgeMs || 7 * 24 * 60 * 60 * 1000), updated = Date.parse(checkpoint.updatedAt || "");
  if (!Number.isFinite(updated) || Date.now() - updated > maxAgeMs) return { valid:false, reason:"expired" };
  return { valid:true, reason:"", checkpoint };
}

export function readDiagnosticCheckpoint(storage, key, unit = {}, options = {}) {
  if (!storage?.getItem) return null;
  let records = {}; try { records = JSON.parse(storage.getItem(key) || "{}"); } catch { return null; }
  const checkpoint = records?.[unit.id];
  return validateDiagnosticCheckpoint(checkpoint, unit, options).valid ? checkpoint : null;
}

export function writeDiagnosticCheckpoint(storage, key, checkpoint) {
  if (!storage?.setItem || !checkpoint?.unitId) return false;
  let records = {}; try { records = JSON.parse(storage.getItem(key) || "{}"); } catch {}
  records[checkpoint.unitId] = checkpoint; storage.setItem(key, JSON.stringify(records)); return true;
}

export function removeDiagnosticCheckpoint(storage, key, unitId = "") {
  if (!storage?.setItem) return false;
  let records = {}; try { records = JSON.parse(storage.getItem(key) || "{}"); } catch {}
  if (!Object.hasOwn(records, unitId)) return false;
  delete records[unitId]; storage.setItem(key, JSON.stringify(records)); return true;
}

export function createDiagnosticRunner({ getUnit, onComplete, showToast, storage = globalThis.localStorage, storageKey = "zhigou-active-diagnostics-v1" } = {}) {
  const style = document.createElement("link"); style.rel = "stylesheet"; style.href = "./diagnostic-runner.css"; document.head.append(style);
  document.body.insertAdjacentHTML("beforeend", `<dialog class="create-dialog" id="diagnosticRunnerDialog"><div class="diagnostic-runner-shell"><header><div><span class="section-kicker">LIVE DIAGNOSIS</span><h2 id="diagnosticRunnerTitle">课堂诊断</h2><p>答案和误解提示默认隐藏，先让学生作答，再记录真实课堂表现。</p></div><button class="dialog-close" id="closeDiagnosticRunner" type="button" aria-label="关闭课堂诊断"><i class="ph ph-x"></i></button></header><div class="diagnostic-runner-body"><div class="diagnostic-progress"><span id="diagnosticCounter"></span><i><em id="diagnosticProgressBar"></em></i></div><section class="diagnostic-question-stage"><span id="diagnosticQuestionLabel"></span><h3 id="diagnosticQuestionPrompt"></h3><div class="diagnostic-reveal-actions"><button type="button" data-diagnostic-reveal="answer">显示判断依据</button><button type="button" data-diagnostic-reveal="misconception">显示常见误解</button></div><div class="diagnostic-reveal hidden" id="diagnosticAnswer"></div><div class="diagnostic-reveal warning hidden" id="diagnosticMisconception"></div></section><aside class="diagnostic-observation"><h3>记录课堂表现</h3><p>选择最接近全班当前情况的一项。</p><div class="diagnostic-result-options"><button type="button" data-diagnostic-result="understood"><i class="ph ph-check-circle"></i><span><b>多数理解</b><small>能说明判断依据</small></span></button><button type="button" data-diagnostic-result="confused"><i class="ph ph-warning-circle"></i><span><b>出现误解</b><small>答案暴露关键偏差</small></span></button><button type="button" data-diagnostic-result="incomplete"><i class="ph ph-clock"></i><span><b>未完成</b><small>时间不足或未作答</small></span></button></div><label>课堂观察备注（可选）<textarea id="diagnosticObservationNote" rows="3" placeholder="例如：多数学生把线程安全等同于加一条锁"></textarea></label></aside></div><footer><span id="diagnosticRunState">运行记录只保存在本机</span><div><button class="button outline" id="previousDiagnostic" type="button"><i class="ph ph-arrow-left"></i> 上一题</button><button class="button dark" id="nextDiagnostic" type="button">下一题 <i class="ph ph-arrow-right"></i></button></div></footer></div></dialog>`);
  const dialog = document.querySelector("#diagnosticRunnerDialog");
  let run = null, index = 0, revealed = [];
  function persistCheckpoint() {
    const unit=getUnit();if(!unit?.id||!run)return;
    writeDiagnosticCheckpoint(storage,storageKey,createDiagnosticCheckpoint(unit.id,unit.lesson?.questions||[],run,index,revealed));
  }
  function render() {
    const observation = run?.observations?.[index]; if (!observation) return;
    document.querySelector("#diagnosticRunnerTitle").textContent = `${getUnit()?.title || "教学单元"} · 课堂诊断`;
    document.querySelector("#diagnosticCounter").textContent = `第 ${index + 1} / ${run.observations.length} 题`;
    document.querySelector("#diagnosticProgressBar").style.width = `${(index + 1) / run.observations.length * 100}%`;
    document.querySelector("#diagnosticQuestionLabel").textContent = `诊断 ${String(index + 1).padStart(2, "0")}`;
    document.querySelector("#diagnosticQuestionPrompt").textContent = observation.prompt;
    let contentWarning = document.querySelector("#diagnosticContentWarning");
    if (!contentWarning) {
      contentWarning = document.createElement("p");
      contentWarning.id = "diagnosticContentWarning";
      contentWarning.className = "legacy-content-warning";
      contentWarning.setAttribute("role", "status");
      document.querySelector("#diagnosticQuestionPrompt").after(contentWarning);
    }
    contentWarning.hidden = !hasPossiblyTruncatedContent(observation);
    contentWarning.textContent = "这道题的原内容可能已被旧版本截断。请在诊断题编辑中核对并补全题干、答案后再用于课堂；放大窗口不能恢复缺失文字。";
    const answer = document.querySelector("#diagnosticAnswer"), misconception = document.querySelector("#diagnosticMisconception");
    answer.textContent = observation.answerCue || "尚未填写判断依据"; misconception.textContent = observation.misconception || "尚未填写常见误解";
    const revealState = revealed[index] || { answer:false, misconception:false };
    answer.classList.toggle("hidden", !revealState.answer); misconception.classList.toggle("hidden", !revealState.misconception);
    document.querySelectorAll("[data-diagnostic-reveal]").forEach(button => { const expanded=Boolean(revealState[button.dataset.diagnosticReveal]);button.setAttribute("aria-expanded", String(expanded)); button.textContent = `${expanded ? "隐藏" : "显示"}${button.dataset.diagnosticReveal === "answer" ? "判断依据" : "常见误解"}`; });
    document.querySelectorAll("[data-diagnostic-result]").forEach(button => { const active = button.dataset.diagnosticResult === observation.result; button.classList.toggle("active", active); button.setAttribute("aria-pressed", String(active)); });
    document.querySelector("#diagnosticObservationNote").value = observation.note || "";
    document.querySelector("#previousDiagnostic").disabled = index === 0;
    const next = document.querySelector("#nextDiagnostic"), last = index === run.observations.length - 1;
    next.innerHTML = last ? '<i class="ph ph-check"></i> 完成并保存' : '下一题 <i class="ph ph-arrow-right"></i>';
    document.querySelector("#diagnosticRunState").textContent = `${summarizeDiagnosticRun(run).understood + summarizeDiagnosticRun(run).confused + summarizeDiagnosticRun(run).incomplete}/${run.observations.length} 题已记录 · 只保存在本机`;
  }
  function open(startIndex = 0) {
    const unit=getUnit(),questions = normalizeDiagnosticQuestions(unit?.lesson?.questions || []); if (!questions.length) { showToast?.("请先添加至少一道诊断问题"); return false; }
    const checkpoint=readDiagnosticCheckpoint(storage,storageKey,unit);
    if(checkpoint){run=structuredClone(checkpoint.run);index=checkpoint.index;revealed=structuredClone(checkpoint.revealed||questions.map(()=>({answer:false,misconception:false})));showToast?.("已恢复上次未完成的课堂诊断")}else{run = createDiagnosticRun(questions); index = Number.isInteger(startIndex) ? Math.max(0, Math.min(questions.length - 1, startIndex)) : 0; revealed = questions.map(() => ({ answer:false, misconception:false }));persistCheckpoint()}
    render(); dialog.showModal(); return true;
  }
  document.querySelector("#closeDiagnosticRunner").onclick = () => {persistCheckpoint();dialog.close();showToast?.("课堂诊断进度已保留")};
  document.querySelector("#previousDiagnostic").onclick = () => { if (index > 0) { index -= 1; persistCheckpoint();render(); } };
  document.querySelector("#nextDiagnostic").onclick = () => { if (index < run.observations.length - 1) { index += 1; persistCheckpoint();render(); return; } run.status = "completed"; run.completedAt = new Date().toISOString(); const summary = summarizeDiagnosticRun(run);removeDiagnosticCheckpoint(storage,storageKey,getUnit()?.id);onComplete?.(structuredClone(run), summary); dialog.close(); };
  document.querySelector("#diagnosticObservationNote").oninput = event => { if (run?.observations?.[index]) {run.observations[index].note = event.target.value.trim();persistCheckpoint()} };
  document.querySelector(".diagnostic-result-options").onclick = event => { const button = event.target.closest("[data-diagnostic-result]"); if (!button || !run?.observations?.[index]) return; run.observations[index].result = button.dataset.diagnosticResult;persistCheckpoint();render(); };
  document.querySelector(".diagnostic-reveal-actions").onclick = event => { const button = event.target.closest("[data-diagnostic-reveal]"); if (!button) return; const key=button.dataset.diagnosticReveal,target = document.querySelector(key === "answer" ? "#diagnosticAnswer" : "#diagnosticMisconception"), expanded = button.getAttribute("aria-expanded") !== "true"; revealed[index] ||= { answer:false, misconception:false };revealed[index][key]=expanded;persistCheckpoint();button.setAttribute("aria-expanded", String(expanded)); button.textContent = `${expanded ? "隐藏" : "显示"}${key === "answer" ? "判断依据" : "常见误解"}`; target.classList.toggle("hidden", !expanded); };
  function decorate() {
    const panel = document.querySelector("#assessmentPanel"); if (!panel) return;
    panel.querySelector(".diagnostic-run-summary")?.remove();
    const unit = getUnit(), runs = Array.isArray(unit?.lesson?.diagnosticRuns) ? unit.lesson.diagnosticRuns : [], latest = runs.at(-1), summary = latest ? summarizeDiagnosticRun(latest) : null,checkpoint=readDiagnosticCheckpoint(storage,storageKey,unit),checkpointSummary=checkpoint?summarizeDiagnosticRun(checkpoint.run):null;
    const card = document.createElement("section"); card.className = "diagnostic-run-summary";
    card.innerHTML = `<div><span class="section-kicker">CLASSROOM MODE</span><h2>课堂诊断运行</h2><p>${checkpoint?`有未完成诊断：${checkpointSummary.understood+checkpointSummary.confused+checkpointSummary.incomplete}/${checkpointSummary.total} 题已记录 · 更新于 ${new Date(checkpoint.updatedAt).toLocaleString("zh-CN",{hour12:false})}`:latest ? `最近一次：${new Date(latest.completedAt || latest.createdAt).toLocaleString("zh-CN", { hour12:false })} · ${summary.total} 题` : "逐题展示，按需揭示答案，并记录学生真实表现。"}</p></div>${summary ? `<div class="diagnostic-latest-metrics"><span><b>${summary.understood}</b>多数理解</span><span class="warn"><b>${summary.confused}</b>出现误解</span><span><b>${summary.incomplete + summary.unobserved}</b>未完成</span></div>` : ""}<button class="button dark" type="button" data-start-diagnostic><i class="ph ph-presentation-chart"></i> ${checkpoint?"继续未完成诊断":latest ? "再次运行" : "开始课堂诊断"}</button>`;
    card.querySelector("[data-start-diagnostic]").onclick = open; panel.prepend(card);
  }
  new MutationObserver(() => { if (!document.querySelector("#assessmentPanel .diagnostic-run-summary")) queueMicrotask(decorate); }).observe(document.querySelector("#assessmentPanel"), { childList:true });
  decorate();
  return { open, decorate };
}
