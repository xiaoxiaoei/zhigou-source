function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

export function normalizeTraceFrames(resource = {}) {
  const codeLines = String(resource.details?.code || "").replace(/\r/g, "").split("\n");
  const maxLine = Math.max(1, codeLines.length);
  const frames = (Array.isArray(resource.details?.traceSteps) ? resource.details.traceSteps : []).map((frame, index) => typeof frame === "object" ? {
    line: Math.max(1, Math.min(maxLine, Number(frame.line) || index + 1)),
    state: String(frame.state || ""),
    explanation: String(frame.explanation || ""),
  } : { line: Math.min(maxLine, index + 1), state: "", explanation: String(frame) }).filter(frame => frame.state || frame.explanation);
  return { codeLines, frames };
}

export function createCodeTracePlayer() {
  const style = document.createElement("link");
  style.rel = "stylesheet";
  style.href = "./code-trace-player.css";
  document.head.append(style);
  document.body.insertAdjacentHTML("beforeend", `<dialog class="create-dialog" id="codeTraceDialog"><div class="code-trace-shell"><header><div><span>GUIDED CODE TRACE</span><h2 id="codeTraceTitle">代码课堂演示</h2><p id="codeTraceMeta"></p></div><button class="dialog-close" id="closeCodeTrace" aria-label="关闭窗口"><i class="ph ph-x"></i></button></header><div class="code-trace-body"><section class="code-trace-source"><div class="code-trace-safety"><i class="ph ph-shield-check"></i><span><b>引导式追踪，不执行代码</b><small>这里只播放已保存的状态帧，不执行代码；AI 生成的轨迹仍需教师核对。</small></span></div><ol id="codeTraceLines"></ol></section><aside class="code-trace-inspector"><span id="codeTraceCounter">步骤 1/1</span><h3 id="codeTraceState">准备开始</h3><p id="codeTraceExplanation"></p><div class="code-trace-position"><i id="codeTraceProgress"></i></div><footer><button class="button outline" id="previousTraceStep"><i class="ph ph-arrow-left"></i> 上一步</button><button class="button dark" id="nextTraceStep">下一步 <i class="ph ph-arrow-right"></i></button></footer></aside></div></div></dialog>`);
  const dialog = document.querySelector("#codeTraceDialog");
  let frames = [];
  let codeLines = [];
  let current = 0;

  function render() {
    const frame = frames[current];
    document.querySelector("#codeTraceLines").innerHTML = codeLines.map((line, index) => `<li class="${frame?.line === index + 1 ? "active" : ""}"><span>${index + 1}</span><code>${escapeHtml(line || " ")}</code></li>`).join("");
    document.querySelector("#codeTraceCounter").textContent = `步骤 ${current + 1}/${frames.length}`;
    document.querySelector("#codeTraceState").textContent = frame?.state || `执行到第 ${frame?.line || 1} 行`;
    document.querySelector("#codeTraceExplanation").textContent = frame?.explanation || "观察当前代码行与状态变化。";
    document.querySelector("#codeTraceProgress").style.width = `${((current + 1) / frames.length) * 100}%`;
    document.querySelector("#previousTraceStep").disabled = current === 0;
    const next = document.querySelector("#nextTraceStep");
    next.disabled = current === frames.length - 1;
    next.innerHTML = current === frames.length - 1 ? '<i class="ph ph-check"></i> 演示完成' : '下一步 <i class="ph ph-arrow-right"></i>';
  }

  function open(resource) {
    const normalized = normalizeTraceFrames(resource);
    if (!normalized.frames.length) return false;
    frames = normalized.frames;
    codeLines = normalized.codeLines;
    current = 0;
    document.querySelector("#codeTraceTitle").textContent = resource.title || "代码课堂演示";
    document.querySelector("#codeTraceMeta").textContent = `${resource.details?.language || "代码"} · ${frames.length} 个待核对的追踪帧`;
    render();
    dialog.showModal();
    return true;
  }
  document.querySelector("#previousTraceStep").onclick = () => { if (current > 0) { current -= 1; render(); } };
  document.querySelector("#nextTraceStep").onclick = () => { if (current < frames.length - 1) { current += 1; render(); } };
  document.querySelector("#closeCodeTrace").onclick = () => dialog.close();
  return { open };
}
