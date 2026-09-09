const FORBIDDEN_SVG = /<\s*(?:script|foreignObject|iframe|object|embed|audio|video)\b|\son\w+\s*=|javascript\s*:|<\s*style[^>]*>[^<]*@import/i;

function cleanText(value = "", max = 180) {
  const text = String(value).replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function sanitizeGeneratedSvg(value) {
  const svg = String(value || "").trim();
  if (svg.length < 80 || svg.length > 80000) return null;
  if (!/^<svg\b[\s\S]*<\/svg>$/i.test(svg) || FORBIDDEN_SVG.test(svg)) return null;
  if (/<!DOCTYPE|<!ENTITY|@import/i.test(svg)) return null;
  if ([...svg.matchAll(/(?:href|src)\s*=\s*["']([^"']*)["']/gi)].some(match => !match[1].startsWith('#'))) return null;
  if ([...svg.matchAll(/url\(\s*["']?([^\s)'";]+)/gi)].some(match => !match[1].startsWith('#'))) return null;
  return svg;
}

export function buildFreeformScene(raw, { title, teachingQuestion, evidence = [] } = {}) {
  const svgMarkup = sanitizeGeneratedSvg(raw?.svgMarkup || raw?.svg);
  if (!svgMarkup) return null;
  const svgIds = new Set([...svgMarkup.matchAll(/\sid=["']([^"']+)["']/g)].map((match) => match[1]));
  const bindings = Array.isArray(raw?.bindings) ? raw.bindings.map((binding) => ({
    svgId: String(binding?.svgId || "").trim(),
    claim: cleanText(binding?.claim, 100),
    role: cleanText(binding?.role, 24),
  })).filter((binding) => svgIds.has(binding.svgId) && binding.claim).slice(0, 8) : [];
  // A free-form composition is only useful when its visible elements can be
  // traced back to distinct teaching claims. This is a semantic contract, not
  // a visual template.
  if (bindings.length < 3) return null;
  const totalDurationMs = Math.max(5000, Math.min(18000, Number(raw?.durationMs) || 9000));
  const phaseTimesInMilliseconds = Array.isArray(raw?.phases) && raw.phases.some(phase => Number(phase.at) > 1);
  const phases = Array.isArray(raw?.phases) ? raw.phases.slice(0, 7).map((phase, index) => ({
    label: cleanText(phase?.label || `第 ${index + 1} 步`, 16),
    focus: cleanText(phase?.focus, 240),
    at: Math.max(0, Math.min(1, phase?.at == null ? index / Math.max(1, raw.phases.length - 1) : (Number(phase.at) || 0) / (phaseTimesInMilliseconds ? totalDurationMs : 1))),
  })).sort((a, b) => a.at - b.at) : [];
  return {
    renderer: "ai-svg",
    version: 1,
    title: cleanText(raw?.title || title, 48),
    teachingQuestion: cleanText(raw?.teachingQuestion || teachingQuestion, 72),
    visualMetaphor: cleanText(raw?.visualMetaphor, 100),
    visualReason: cleanText(raw?.designRationale || raw?.visualReason, 160),
    representationStrategy: cleanText(raw?.representationStrategy, 160),
    svgMarkup,
    bindings,
    teachingCheck: cleanText(raw?.teachingCheck, 160),
    phases: phases.length ? phases : [{ label: "呈现逻辑", at: 0 }],
    totalDurationMs,
    evidence: evidence.slice(0, 4),
  };
}

export function freeformSceneQualityIssues(scene) {
  if (!scene) return ["没有可用场景"];
  const issues = [];
  if ((scene.bindings || []).length < 4) issues.push("可见事实绑定少于 4 项");
  if ((scene.phases || []).length < 4) issues.push("解释阶段少于 4 个");
  if (String(scene.teachingCheck || "").length < 8) issues.push("缺少可验证的观看问题");
  const svg = String(scene.svgMarkup || "");
  const ids=[...svg.matchAll(/\sid=["']([^"']+)["']/g)].map(m=>m[1]);
  if(new Set(ids).size!==ids.length)issues.push('SVG存在重复id；不同阶段复用对象请使用不同id或class');
  const exclusive=/phase-group|data-phase-mode=["']exclusive/.test(svg);
  const marked=new Set([...svg.matchAll(/data-phase-index=["'](\d+)["']/g)].map(m=>Number(m[1])));
  if(exclusive&&(scene.phases||[]).some((_,i)=>!marked.has(i)))issues.push('互斥画面缺少某个声明阶段，跳转后会空白；每个阶段必须有对应图形组');
  if(/<animate\b[^>]*attributeName=["']display["']/i.test(svg))issues.push('不要动画化display属性；阶段显示由播放器管理，避免整个画布被隐藏');
  const appliedAnimations=(svg.match(/<animate(?:Transform|Motion)?\b|animation(?:-name)?\s*:/gi)||[]).length;
  if(/@keyframes/.test(svg)&&appliedAnimations<2)issues.push('只定义了keyframes但没有应用到对象，请给实际图形绑定运动');
  const animationCount = (svg.match(/<animate(?:Transform|Motion)?\b|@keyframes\b|animation\s*:/gi) || []).length;
  if (animationCount < 2) issues.push("有意义的动态变化少于 2 处");
  const phaseMarkerCount = (svg.match(/data-phase-index\s*=/gi) || []).length;
  if (phaseMarkerCount < 3) issues.push("画面缺少可跟随的阶段标记");
  // Geometry must be inspected in the rendered coordinate system, per frame.
  // Shape counts cannot determine whether a teaching representation is useful.
  return issues;
}

export function assessFreeformScene(scene) {
  const issues = freeformSceneQualityIssues(scene);
  const blockers = issues.filter(message => /没有可用场景|重复id|缺少某个声明阶段|display属性/.test(message));
  return { blockers, warnings: issues.filter(message => !blockers.includes(message)), status: issues.length ? 'needs-review' : 'pending-preview' };
}
