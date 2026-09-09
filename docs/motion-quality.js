function hasText(value, minimum = 1) {
  return String(value || "").trim().length >= minimum;
}

function check(id, label, pass, detail, blocking = true) {
  return { id, label, pass: pass === null ? null : Boolean(pass), pending: pass === null, detail, blocking };
}

export function assessMotionQuality(motion = {}) {
  const scene = motion.scene || {};
  const svg = String(scene.svgMarkup || "");
  const objects = Math.max((scene.bindings || []).length, (scene.entities || []).length, (scene.nodes || []).length, (scene.items || []).length);
  const relations = Math.max((scene.relations || []).length, (scene.edges || []).length, (scene.modes || []).length);
  const phases = Array.isArray(scene.phases) ? scene.phases : [];
  const animations = (svg.match(/<animate(?:Transform|Motion)?\b|@keyframes\b|animation\s*:/gi) || []).length;
  const phaseMarkers = (svg.match(/data-phase-index\s*=/gi) || []).length;
  const genericMotion = scene.renderer !== "ai-svg" && (relations > 0 || /data-motion-track/.test(svg) || phases.some(phase => phase.action));
  const textNodes = [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/gi)].map(match => match[1].replace(/<[^>]+>/g, "").trim()).filter(Boolean);
  const textCharacters = textNodes.join("").length;
  const evidenceCount = Math.max((motion.evidence || []).length, (scene.evidence || []).length, (scene.bindings || []).filter(item => hasText(item?.claim, 4)).length);
  const layoutWarnings = motion.runtimeCheck?.warnings || [];
  const collision = layoutWarnings.length > 0;
  const uniqueIds=[...svg.matchAll(/\sid=["']([^"']+)["']/g)].map(m=>m[1]);
  const indices=new Set([...svg.matchAll(/data-phase-index=["'](\d+)["']/g)].map(m=>Number(m[1])));
  const checks = [
    check("phase-coverage","互斥画面包含全部阶段",!(/phase-group|data-phase-mode=["']exclusive/.test(svg))||phases.every((_,i)=>indices.has(i)),"阶段标记必须与实际画面对应"),
    check("unique-ids","对象标识没有重复",new Set(uniqueIds).size===uniqueIds.length,"重复标识可能让对象引用失效"),
    check("display-animation","画布不会被显示动画隐藏",!/<animate\b[^>]*attributeName=["']display["']/i.test(svg),"阶段显示由播放器管理"),
    ...(motion.runtimeCheck ? [check("runtime", "首帧、中间帧和末帧存在可见图形", motion.runtimeCheck.passed, motion.runtimeCheck.detail)] : []),
    check("objects", "可见对象对应教学事实", objects >= 3, `识别到 ${objects} 个可解释对象。`),
    check("logic", "画面表达对象关系或状态机制", relations > 0 || (scene.bindings || []).length >= 3, relations ? `${relations} 条关系或机制路径。` : "依靠可见事实绑定表达机制。"),
    check("phases", "原理被拆成可跟随阶段", phases.length >= 3, `当前 ${phases.length} 个解释阶段。`),
    check("motion", "动态变化服务于原理", genericMotion || animations >= 2 || phaseMarkers >= 3, `动态元素 ${animations} 处，阶段标记 ${phaseMarkers} 处。`),
    check("question", "观看任务可以检验理解", hasText(motion.teachingQuestion || scene.teachingQuestion || scene.teachingCheck, 8), "学生观看前应知道需要判断什么。"),
    check("explanation", "包含独立的原理讲解", hasText(motion.narration || motion.explanation || scene.designRationale || scene.visualReason, 24), "动画之外仍需能用文字说清机制。"),
    check("layout", "逐阶段布局检查", motion.runtimeCheck ? !collision : null, motion.runtimeCheck ? (collision ? layoutWarnings.map(w=>w.object+'：'+w.detail+'（'+w.at.join('/')+'%）').join('；') : '采样时刻未发现明显重叠；仍需教师试播。') : '尚未试播，不能从源码判断实际布局。', false),
    ...(motion.generationQuality?.blockers || []).map((detail,i)=>check('generation-'+i,'生成结构待修复',false,detail)),
    ...(motion.generationQuality?.warnings || []).map((detail,i)=>check('advice-'+i,'表达待核对',false,detail,false)),
    check("evidence", "建议保留材料或事实绑定", evidenceCount > 0, `可追溯事实 ${evidenceCount} 项。`, false),
    check("density", "画面文字保持简洁", textNodes.length <= 22 && textCharacters <= 420, `${textNodes.length} 个文字节点，共 ${textCharacters} 字。`, false),
  ];
  const blockers = checks.filter(item => item.blocking && !item.pass);
  const warnings = checks.filter(item => !item.blocking && !item.pass && !item.pending);
  return { score: Math.round((checks.filter(item => item.pass).length / checks.length) * 100), ready: blockers.length === 0, blockers, warnings, checks, metrics: { objects, relations, phases: phases.length, animations, phaseMarkers, textNodes: textNodes.length, textCharacters, evidenceCount } };
}

export function getMotionQualityState(motion = {}) {
  const assessment = assessMotionQuality(motion);
  const reviewStatus = motion.qualityReview?.status;
  if (reviewStatus === "approved" && assessment.ready && motion.runtimeCheck?.passed === true) return { id: "approved", label: "教师已确认", assessment };
  if (reviewStatus === "needs-revision" || !assessment.ready) return { id: "needs-revision", label: "需修改", assessment };
  return { id: "auto-pass", label: motion.runtimeCheck?.passed ? "试播通过 · 待教师审核" : "结构检查通过 · 待试播", assessment };
}

export function buildMotionRevisionInstruction(assessment = {}) {
  const issuePrompts = {
    objects: "增加与知识原理直接对应的可见对象，并让每个对象承担明确教学事实",
    logic: "重新表达对象之间的因果、状态变化或作用机制，不能只并列摆放元素",
    phases: "把条件、触发、中间机制和结果拆成至少四个可跟随阶段",
    motion: "增加能揭示状态变化或作用过程的动态表现，不能只使用淡入和变色",
    question: "补充学生观看前可以预测、观看后可以验证的具体问题",
    explanation: "补充独立的原理讲解，说明中间机制为何产生最终结果",
    layout: "重新规划连接线，从节点边界外 12–20 像素处结束，避免箭头进入方框、遮挡文字或横穿对象",
    evidence: "保留每个关键视觉对象对应的材料事实或原文依据",
    density: "删减画面文字，只保留对象名、状态和关键结果，把完整解释移到画面下方",
  };
  const issues = [...(assessment.blockers || []), ...(assessment.warnings || [])];
  if (!issues.length) return "在保留知识事实和观看问题的前提下，进一步提高视觉层级、阶段衔接和课堂可读性。";
  return `请保持知识事实、观看问题和正确结论不变，并完成以下修改：\n${issues.map((item, index) => `${index + 1}. ${issuePrompts[item.id] ? `${issuePrompts[item.id]}；检查定位：${item.detail}` : `${item.label}：${item.detail}`}`).join("\n")}\n修改后仍需保持学术简洁风格，并让学生只看画面就能指出关键中间机制。`;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

export function createMotionQualityPanel({ getMotion, onReview, showToast }) {
  const style = document.createElement("link"); style.rel = "stylesheet"; style.href = "./motion-quality.css"; document.head.append(style);
  const explanation = document.querySelector("#motionDialog .explanation-card");
  explanation.insertAdjacentHTML("afterend", `<section class="motion-quality-card" id="motionQualityCard"><header><div><span><i class="ph ph-shield-check"></i> 动效质量体检</span></div><strong id="motionQualityScore">0</strong></header><div id="motionQualitySummary"></div><div class="motion-quality-grid" id="motionQualityChecks"></div><footer><span id="motionReviewState"></span><div><button class="button ghost" id="prefillMotionRevision" type="button"><i class="ph ph-wand"></i> 按体检结果修改</button><button class="button outline" id="motionNeedsRevision" type="button">标记需修改</button><button class="button dark" id="approveMotion" type="button">确认课堂可用</button></div></footer></section>`);
  let activeAssessment = null;
  function render() {
    const motion = getMotion(); if (!motion) return;
    activeAssessment = assessMotionQuality(motion);
    document.querySelector("#motionQualityScore").textContent = activeAssessment.score;
    document.querySelector("#motionQualitySummary").innerHTML = activeAssessment.ready ? `<b>${motion.runtimeCheck ? "结构与试播检查完成" : "结构检查完成 · 待试播"}</b><small>${activeAssessment.warnings.length ? `仍有 ${activeAssessment.warnings.length} 项建议人工确认。` : "当前未发现明显风险。"}</small>` : `<b>发现 ${activeAssessment.blockers.length} 项阻塞问题</b><small>修正后才能确认课堂可用。</small>`;
    document.querySelector("#motionQualityChecks").innerHTML = activeAssessment.checks.map(item => `<article class="${item.pass ? "pass" : item.blocking ? "fail" : "warn"}"><i class="ph ${item.pass ? "ph-check-circle" : item.blocking ? "ph-x-circle" : "ph-warning-circle"}"></i><div><b>${escapeHtml(item.label)}</b><small>${escapeHtml(item.detail)}</small></div><em>${item.pending ? "待试播" : item.pass ? "通过" : item.blocking ? "需修正" : "建议"}</em></article>`).join("");
    const review = motion.qualityReview || {};
    document.querySelector("#motionReviewState").textContent = review.status === "approved" ? "教师已确认课堂可用" : review.status === "needs-revision" ? "教师已标记需修改" : "尚未完成人工确认";
    const approve = document.querySelector("#approveMotion"); approve.disabled = !activeAssessment.ready || motion.runtimeCheck?.passed !== true || review.status === "approved"; approve.textContent = review.status === "approved" ? "已确认课堂可用" : "确认课堂可用";
  }
  document.querySelector("#approveMotion").onclick = () => { if (!activeAssessment?.ready) return showToast("请先解决动效体检中的阻塞问题"); onReview("approved", activeAssessment); };
  document.querySelector("#motionNeedsRevision").onclick = () => onReview("needs-revision", activeAssessment);
  document.querySelector("#prefillMotionRevision").onclick = () => { const field = document.querySelector("#motionRevision"); field.value = buildMotionRevisionInstruction(activeAssessment); field.focus(); field.scrollIntoView({ behavior: "smooth", block: "center" }); showToast("已生成修改要求；确认后再调用模型，不会自动扣费"); };
  const observer = new MutationObserver(() => queueMicrotask(render)); observer.observe(document.querySelector("#motionStage"), { childList: true });
  return { render };
}
