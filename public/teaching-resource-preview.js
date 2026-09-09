import { normalizeResourceDetails } from "./resource-details.js";

const typeLabels = { code: "代码演示", lab: "实验任务", case: "教学案例" };
const esc = (value = "") => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

export function buildResourcePreviewModel(resource = {}) {
  const type = ["code", "lab", "case"].includes(resource.type) ? resource.type : "";
  if (!type) return null;
  const details = normalizeResourceDetails(resource, type);
  if (type === "code") return {
    type, label: typeLabels[type], title: resource.title || "未命名代码演示", purpose: resource.purpose || "尚未填写教学用途", details,
    count: details.traceSteps.length, ready: Boolean(details.code && details.walkthrough),
  };
  if (type === "lab") return {
    type, label: typeLabels[type], title: resource.title || "未命名实验任务", purpose: resource.purpose || "尚未填写教学用途", details,
    count: details.steps.length, totalPoints: details.rubric.reduce((sum, item) => sum + Number(item.points || 0), 0), ready: Boolean(details.objective && details.steps.length && details.deliverables),
  };
  return {
    type, label: typeLabels[type], title: resource.title || "未命名教学案例", purpose: resource.purpose || "尚未填写教学用途", details,
    count: details.questions.length, ready: Boolean(details.context && details.scenario && details.questions.length),
  };
}

function codeMarkup(model) {
  const d = model.details;
  return `<div class="teaching-preview-grid"><section><h3>演示代码</h3><pre><code>${esc(d.code || "尚未填写代码")}</code></pre></section><aside><dl><div><dt>语言 / 环境</dt><dd>${esc(d.language || "未记录")}</dd></div>${d.sampleInput ? `<div><dt>示例输入 / 初始条件</dt><dd>${esc(d.sampleInput)}</dd></div>` : ""}<div><dt>课堂观察重点</dt><dd>${esc(d.walkthrough || "尚未填写")}</dd></div></dl>${model.count ? `<p class="preview-safe-note"><i class="ph ph-shield-check"></i>${model.count} 个已保存的追踪帧（未执行验证）；只引导播放，不执行代码。</p>` : '<p class="preview-warning">尚未设置单步追踪帧，可先使用静态代码讲解。</p>'}</aside></div>`;
}

function labMarkup(model) {
  const d = model.details;
  return `<div class="teaching-preview-grid"><section><h3>课堂实验清单</h3><p class="preview-lead">${esc(d.objective || "尚未填写实验目标")}</p><div class="preview-lab-progress"><i><em></em></i><span>0/${model.count} 步</span></div><ol class="preview-lab-steps">${d.steps.length ? d.steps.map((step, index) => `<li><button type="button" data-preview-lab-step="${index}" aria-pressed="false"><i class="ph ph-circle"></i><span><b>步骤 ${index + 1}</b>${esc(step)}</span></button></li>`).join("") : "<li>尚未填写实验步骤</li>"}</ol></section><aside><dl>${d.estimatedMinutes ? `<div><dt>预计用时</dt><dd>${Number(d.estimatedMinutes)} 分钟</dd></div>` : ""}${d.prerequisites ? `<div><dt>环境与前置条件</dt><dd>${esc(d.prerequisites)}</dd></div>` : ""}<div><dt>提交物与验收证据</dt><dd>${esc(d.deliverables || "尚未填写")}</dd></div></dl>${d.rubric.length ? `<h3>评分量规 · ${model.totalPoints} 分</h3><table><thead><tr><th>评价维度</th><th>达标标准</th><th>分值</th></tr></thead><tbody>${d.rubric.map(item => `<tr><td>${esc(item.criterion)}</td><td>${esc(item.standard)}</td><td>${Number(item.points) || 0}</td></tr>`).join("")}</tbody></table>` : '<p class="preview-warning">尚未建立评分量规。</p>'}</aside></div>`;
}

function caseMarkup(model) {
  const d = model.details;
  return `<div class="teaching-preview-grid"><section><h3>案例情境</h3><p class="preview-context">${esc(d.context || "尚未填写案例背景")}</p><div class="preview-scenario">${esc(d.scenario || "尚未填写案例材料")}</div></section><aside><h3>课堂讨论问题</h3><ol class="preview-case-questions">${d.questions.length ? d.questions.map(question => `<li>${esc(question)}</li>`).join("") : "<li>尚未填写讨论问题</li>"}</ol><button type="button" class="preview-reveal-notes" aria-expanded="false">显示教师引导与收束</button><div class="preview-teaching-notes hidden">${esc(d.teachingNotes || "尚未填写教师引导")}</div></aside></div>`;
}

export function createTeachingResourcePreview({ tracePlayer } = {}) {
  const style = document.createElement("link"); style.rel = "stylesheet"; style.href = "/teaching-resource-preview.css"; document.head.append(style);
  document.body.insertAdjacentHTML("beforeend", `<dialog class="create-dialog" id="teachingResourcePreviewDialog"><div class="teaching-preview-shell"><header><div><span class="section-kicker" id="teachingPreviewType">TEACHING ASSET</span><h2 id="teachingPreviewTitle">课堂资源预览</h2><p id="teachingPreviewPurpose"></p></div><button class="dialog-close" id="closeTeachingPreview" type="button" aria-label="关闭课堂预览"><i class="ph ph-x"></i></button></header><div class="teaching-preview-body" id="teachingPreviewBody"></div><footer><span id="teachingPreviewState"></span><div><button class="button outline hidden" id="startTeachingTrace" type="button"><i class="ph ph-presentation-chart"></i> 播放单步追踪</button><button class="button dark" id="closeTeachingPreviewFooter" type="button">关闭预览</button></div></footer></div></dialog>`);
  const dialog = document.querySelector("#teachingResourcePreviewDialog"), body = document.querySelector("#teachingPreviewBody");
  let currentResource = null;
  function close() { dialog.close(); }
  document.querySelector("#closeTeachingPreview").onclick = close;
  document.querySelector("#closeTeachingPreviewFooter").onclick = close;
  document.querySelector("#startTeachingTrace").onclick = () => { if (currentResource && tracePlayer?.open(currentResource)) { dialog.close(); } };
  body.onclick = event => {
    const step = event.target.closest("[data-preview-lab-step]");
    if (step) {
      const done = step.getAttribute("aria-pressed") !== "true"; step.setAttribute("aria-pressed", String(done));
      step.querySelector("i").className = `ph ${done ? "ph-check-circle" : "ph-circle"}`;
      const all = [...body.querySelectorAll("[data-preview-lab-step]")], completed = all.filter(item => item.getAttribute("aria-pressed") === "true").length;
      body.querySelector(".preview-lab-progress em").style.width = `${all.length ? completed / all.length * 100 : 0}%`;
      body.querySelector(".preview-lab-progress span").textContent = `${completed}/${all.length} 步`;
    }
    const reveal = event.target.closest(".preview-reveal-notes");
    if (reveal) { const notes = body.querySelector(".preview-teaching-notes"), expanded = reveal.getAttribute("aria-expanded") !== "true"; reveal.setAttribute("aria-expanded", String(expanded)); reveal.textContent = expanded ? "隐藏教师引导与收束" : "显示教师引导与收束"; notes.classList.toggle("hidden", !expanded); }
  };
  function open(resource) {
    const model = buildResourcePreviewModel(resource); if (!model) return false;
    currentResource = { ...resource, type: model.type, details: model.details };
    document.querySelector("#teachingPreviewType").textContent = model.label.toUpperCase();
    document.querySelector("#teachingPreviewTitle").textContent = model.title;
    document.querySelector("#teachingPreviewPurpose").textContent = model.purpose;
    body.innerHTML = model.type === "code" ? codeMarkup(model) : model.type === "lab" ? labMarkup(model) : caseMarkup(model);
    const trace = document.querySelector("#startTeachingTrace"); trace.classList.toggle("hidden", model.type !== "code" || !model.count);
    document.querySelector("#teachingPreviewState").textContent = model.ready ? "内容结构完整，可继续课堂核对" : "当前为预览草稿，仍有内容待完善";
    dialog.showModal(); return true;
  }
  return { open };
}
