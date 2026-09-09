import { buildClassroomTimeline } from "./classroom-timeline.js";
import { loadClassroomProgress, saveClassroomProgress } from "./classroom-progress.js";

const esc = (value = "") => String(value || "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

export function classroomPhaseAt(rows = [], elapsedSeconds = 0) {
  if (!rows.length) return -1;
  const elapsedMinutes = Math.max(0, Number(elapsedSeconds) || 0) / 60;
  const index = rows.findIndex(row => elapsedMinutes < row.end);
  return index < 0 ? rows.length - 1 : index;
}

export function classroomRunModel(unit = {}, elapsedSeconds = 0) {
  const timeline = buildClassroomTimeline(unit), phaseIndex = classroomPhaseAt(timeline.rows, elapsedSeconds);
  const row = timeline.rows[phaseIndex] || null;
  const totalSeconds = Math.max(0, timeline.totalMinutes * 60);
  const phaseStartSeconds = row ? row.start * 60 : 0;
  const phaseEndSeconds = row ? row.end * 60 : 0;
  return {
    ...timeline,
    phaseIndex,
    row,
    totalSeconds,
    elapsedSeconds: Math.min(totalSeconds, Math.max(0, Math.floor(Number(elapsedSeconds) || 0))),
    phaseElapsedSeconds: row ? Math.max(0, Math.floor(Number(elapsedSeconds) || 0) - phaseStartSeconds) : 0,
    phaseRemainingSeconds: row ? Math.max(0, phaseEndSeconds - Math.floor(Number(elapsedSeconds) || 0)) : 0,
  };
}

function clock(seconds = 0) {
  const value = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function assetLabel(item = {}) {
  return item.type === "question" ? "诊断题" : item.type === "motion" ? "动态解释" : item.type === "code" ? "代码演示" : item.type === "lab" ? "实验任务" : "教学案例";
}

export function createClassroomPresenter({ getUnit, onOpenItem, showToast } = {}) {
  const style = document.createElement("link"); style.rel = "stylesheet"; style.href = "./classroom-presenter.css"; document.head.append(style);
  const timelineStyle = document.createElement("style"); timelineStyle.textContent = ".timeline-hero-actions{display:flex;align-items:center;gap:8px}.timeline-hero-actions .button{white-space:nowrap}@media(max-width:700px){.timeline-hero-actions{flex-wrap:wrap}}"; document.head.append(timelineStyle);
  document.body.insertAdjacentHTML("beforeend", `<dialog class="classroom-presenter" id="classroomPresenterDialog"><div class="classroom-presenter-shell"><header><div><span class="section-kicker">LIVE CLASSROOM</span><h1 id="classroomPresenterTitle"></h1><p id="classroomPresenterMeta"></p></div><button type="button" id="closeClassroomPresenter" aria-label="结束课堂模式"><i class="ph ph-x"></i></button></header><nav id="classroomPhaseNav" aria-label="课堂环节"></nav><main><section class="classroom-live-stage"><div class="classroom-phase-heading"><div><span id="classroomPhaseNumber"></span><h2 id="classroomPhaseTitle"></h2></div><div class="classroom-clock"><small>本环节剩余</small><b id="classroomPhaseClock">00:00</b></div></div><div class="classroom-action-grid"><article><span><i class="ph ph-chalkboard-teacher"></i> 教师动作</span><p id="classroomTeacherAction"></p></article><article><span><i class="ph ph-student"></i> 学生任务</span><p id="classroomStudentAction"></p></article></div><section class="classroom-live-assets"><header><div><span>本环节资源</span><small>单击即可打开，返回后课堂计时继续</small></div></header><div id="classroomLiveAssets"></div></section></section><aside><div class="classroom-total-progress"><div><span>整节课进度</span><b id="classroomTotalClock"></b></div><i><em id="classroomTotalBar"></em></i></div><div class="classroom-next-card"><small>下一环节</small><b id="classroomNextPhase"></b></div><p class="classroom-keyboard-note"><i class="ph ph-keyboard"></i> 空格开始/暂停，方向键切换环节</p></aside></main><footer><button type="button" class="button outline" id="previousClassroomPhase"><i class="ph ph-arrow-left"></i> 上一环节</button><div><button type="button" class="button outline" id="resetClassroomTimer"><i class="ph ph-arrow-counter-clockwise"></i> 重置</button><button type="button" class="button dark classroom-play" id="toggleClassroomTimer"><i class="ph ph-play"></i> 开始计时</button></div><button type="button" class="button outline" id="nextClassroomPhase">下一环节 <i class="ph ph-arrow-right"></i></button></footer></div></dialog>`);
  const dialog = document.querySelector("#classroomPresenterDialog");
  let elapsedSeconds = 0, playing = false, timer = null, lastTick = 0;
  let activeUnit = null, lastSavedSecond = -1, storageWarned = false;
  function saveProgress(force = false) {
    if (!activeUnit || (!force && Math.floor(elapsedSeconds) === lastSavedSecond)) return;
    lastSavedSecond = Math.floor(elapsedSeconds);
    let saved = false;
    try { saved = saveClassroomProgress(localStorage, activeUnit, elapsedSeconds); } catch {}
    if (!saved && !storageWarned) { storageWarned = true; showToast?.("浏览器暂时无法保存课堂进度，请保持页面打开"); }
  }

  function stop() { playing = false; if (timer) clearInterval(timer); timer = null; lastTick = 0; saveProgress(true); }
  function jumpTo(index) { const rows = buildClassroomTimeline(getUnit()).rows; if (!rows.length) return; const target = Math.max(0, Math.min(rows.length - 1, Number(index) || 0)); elapsedSeconds = rows[target].start * 60; render(); }
  function render() {
    const unit = getUnit(), model = classroomRunModel(unit, elapsedSeconds), row = model.row;
    if (!row) return;
    elapsedSeconds = Math.min(model.totalSeconds, Math.max(0, elapsedSeconds));
    saveProgress();
    document.querySelector("#classroomPresenterTitle").textContent = unit.title || "课堂模式";
    document.querySelector("#classroomPresenterMeta").textContent = `${unit.course || "未归入课程"} · ${model.totalMinutes} 分钟 · ${model.rows.length} 个课堂环节`;
    document.querySelector("#classroomPhaseNav").innerHTML = model.rows.map((item, index) => `<button type="button" class="${index === model.phaseIndex ? "active" : index < model.phaseIndex ? "done" : ""}" data-classroom-phase="${index}" aria-current="${index === model.phaseIndex ? "step" : "false"}"><span>${String(index + 1).padStart(2, "0")}</span><b>${esc(item.activity.phase || `环节 ${index + 1}`)}</b><small>${item.minutes}′</small></button>`).join("");
    document.querySelector("#classroomPhaseNumber").textContent = `环节 ${String(model.phaseIndex + 1).padStart(2, "0")} · ${row.start}′—${row.end}′`;
    document.querySelector("#classroomPhaseTitle").textContent = row.activity.phase || `课堂环节 ${model.phaseIndex + 1}`;
    document.querySelector("#classroomTeacherAction").textContent = row.activity.teacherAction || "尚未填写教师动作";
    document.querySelector("#classroomStudentAction").textContent = row.activity.studentAction || "尚未填写学生任务";
    document.querySelector("#classroomPhaseClock").textContent = clock(model.phaseRemainingSeconds);
    document.querySelector("#classroomTotalClock").textContent = `${clock(model.elapsedSeconds)} / ${clock(model.totalSeconds)}`;
    document.querySelector("#classroomTotalBar").style.width = `${model.totalSeconds ? model.elapsedSeconds / model.totalSeconds * 100 : 0}%`;
    document.querySelector("#classroomNextPhase").textContent = model.rows[model.phaseIndex + 1]?.activity?.phase || "本节课最后一个环节";
    document.querySelector("#previousClassroomPhase").disabled = model.phaseIndex === 0;
    document.querySelector("#nextClassroomPhase").disabled = model.phaseIndex === model.rows.length - 1;
    document.querySelector("#toggleClassroomTimer").innerHTML = playing ? '<i class="ph ph-pause"></i> 暂停计时' : '<i class="ph ph-play"></i> 开始计时';
    document.querySelector("#classroomLiveAssets").innerHTML = row.items.length ? row.items.map(item => `<button type="button" data-classroom-item="${item.kind}:${item.index}"><i class="ph ${item.type === "motion" ? "ph-play-circle" : item.type === "code" ? "ph-code" : item.type === "lab" ? "ph-flask" : item.type === "question" ? "ph-question" : "ph-cards"}"></i><span><small>${assetLabel(item)}</small><b>${esc(item.title)}</b></span><i class="ph ph-arrow-square-out"></i></button>`).join("") : '<p>这个环节还没有安排资源，可返回备课时间轴继续编排。</p>';
  }
  function toggle() {
    if (playing) { stop(); render(); return; }
    const model = classroomRunModel(getUnit(), elapsedSeconds); if (model.elapsedSeconds >= model.totalSeconds) elapsedSeconds = 0;
    playing = true; lastTick = Date.now();
    timer = setInterval(() => { const now = Date.now(); elapsedSeconds += Math.max(0, (now - lastTick) / 1000); lastTick = now; const next = classroomRunModel(getUnit(), elapsedSeconds); if (next.elapsedSeconds >= next.totalSeconds) { elapsedSeconds = next.totalSeconds; stop(); showToast?.("本节课计时已完成"); } render(); }, 500);
    render();
  }
  function open() {
    if (dialog.open) return true;
    const unit = getUnit(), model = classroomRunModel(unit, 0);
    if (!model.rows.length) { showToast?.("请先建立课堂环节"); return false; }
    stop(); activeUnit = unit; lastSavedSecond = -1;
    try { elapsedSeconds = Math.min(model.totalSeconds, loadClassroomProgress(localStorage, unit)); } catch { elapsedSeconds = 0; }
    render(); dialog.showModal();
    if (elapsedSeconds > 0) showToast?.("已恢复上次课堂进度，点击开始计时继续；重置可从头开始");
    return true;
  }
  window.addEventListener("pagehide", stop);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") saveProgress(true); });
  document.querySelector("#closeClassroomPresenter").onclick = () => { stop(); dialog.close(); };
  dialog.addEventListener("close", () => { stop(); activeUnit = null; });
  document.querySelector("#toggleClassroomTimer").onclick = toggle;
  document.querySelector("#resetClassroomTimer").onclick = () => { stop(); elapsedSeconds = 0; render(); };
  document.querySelector("#previousClassroomPhase").onclick = () => jumpTo(classroomRunModel(getUnit(), elapsedSeconds).phaseIndex - 1);
  document.querySelector("#nextClassroomPhase").onclick = () => jumpTo(classroomRunModel(getUnit(), elapsedSeconds).phaseIndex + 1);
  document.querySelector("#classroomPhaseNav").onclick = event => { const button = event.target.closest("[data-classroom-phase]"); if (button) jumpTo(button.dataset.classroomPhase); };
  document.querySelector("#classroomLiveAssets").onclick = event => { const button = event.target.closest("[data-classroom-item]"); if (!button) return; const [kind, index] = button.dataset.classroomItem.split(":"); onOpenItem?.(kind, Number(index)); };
  dialog.addEventListener("keydown", event => { if (event.target.closest("button") && event.code === "Space") return; if (event.code === "Space") { event.preventDefault(); toggle(); } else if (event.key === "ArrowLeft") jumpTo(classroomRunModel(getUnit(), elapsedSeconds).phaseIndex - 1); else if (event.key === "ArrowRight") jumpTo(classroomRunModel(getUnit(), elapsedSeconds).phaseIndex + 1); });
  return { open, close: () => { stop(); dialog.close(); }, model: () => classroomRunModel(getUnit(), elapsedSeconds) };
}
