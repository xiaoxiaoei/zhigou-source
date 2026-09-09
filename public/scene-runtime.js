const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
import {safeSvg} from './safe-svg.js';

function escapeXml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  })[char]);
}

function short(value = "", max = 18) {
  const text = String(value).replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function textLines(value, x, y, { max = 10, lines = 2, className = "scene-label", lineHeight = 22 } = {}) {
  const text = String(value || "").trim();
  const chunks = [];
  let rest = text;
  while (rest && chunks.length < lines) {
    if (rest.length <= max) {
      chunks.push(rest);
      rest = "";
      break;
    }
    chunks.push(rest.slice(0, max));
    rest = rest.slice(max);
  }
  if (rest && chunks.length) chunks[chunks.length - 1] = `${chunks.at(-1).slice(0, -1)}…`;
  return `<text class="${className}" x="${x}" y="${y}" text-anchor="middle">${chunks.map((line, index) => `<tspan x="${x}" dy="${index ? lineHeight : 0}">${escapeXml(line)}</tspan>`).join("")}</text>`;
}

function commonDefs() {
  return `<defs>
    <linearGradient id="actorViolet" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#7659f6"/><stop offset="1" stop-color="#a696ff"/></linearGradient>
    <linearGradient id="actorCyan" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#0db6df"/><stop offset="1" stop-color="#7bddf6"/></linearGradient>
    <linearGradient id="pulseGradient" x1="0" x2="1"><stop stop-color="#7457ef"/><stop offset="1" stop-color="#23bce5"/></linearGradient>
    <filter id="softShadow" x="-40%" y="-40%" width="180%" height="190%"><feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#23365f" flood-opacity=".15"/></filter>
    <filter id="softGlow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="7" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <marker id="arrowViolet" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10Z" fill="#7659f6"/></marker>
    <marker id="arrowCyan" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10Z" fill="#20bce7"/></marker>
  </defs>`;
}

function actorMarkup(entity, x, color, phaseIndex) {
  const gradient = color === "cyan" ? "actorCyan" : "actorViolet";
  return `<g class="scene-entity actor" data-node-id="${escapeXml(entity.id)}" data-phase-index="${phaseIndex}" transform="translate(${x} 265)">
    <circle class="actor-halo" r="92"/><circle class="actor-ring" r="73"/><circle class="actor-core" r="54" fill="url(#${gradient})"/>
    <rect x="-22" y="-17" width="44" height="30" rx="5" class="actor-screen"/><path d="M-12 24H12M0 13V24" class="actor-stand"/>
    ${textLines(entity.label, 0, 112, { max: 8, lines: 1, className: "actor-label" })}
  </g>`;
}

export function scenePhases(scene, modeId = scene?.defaultMode) {
  if (scene?.renderer === "ai-svg") return scene.phases || [];
  if (scene?.visualType !== "mechanism") return scene?.phases || scene?.sequence || [];
  const mode = scene.modes?.find((item) => item.id === modeId) || scene.modes?.[0];
  const middle = mode?.kind === "buffer" ? ["进入媒介", "暂存"] : mode?.kind === "remote" ? ["请求", "响应"] : mode?.kind === "shared" ? ["写入", "读取"] : ["传递", "作用"];
  return [
    { id: "phase-input", label: "输入", action: "emit", at: 0 },
    { id: "phase-route", label: middle[0], action: "route", at: 0.34 },
    { id: "phase-wait", label: middle[1], action: "hold", at: 0.62 },
    { id: "phase-output", label: "输出", action: "receive", at: 1 },
  ];
}

function mechanismChannel(mode) {
  if (mode?.kind === "buffer") {
    return `<path data-motion-track id="scene-motion-track" d="M260 265 C335 265 362 265 430 265 L690 265 C758 265 790 265 860 265" class="mechanism-path" marker-end="url(#arrowViolet)"/>
      <g class="channel buffer-channel" data-node-id="channel" data-phase-index="1">
        <rect x="430" y="206" width="260" height="118" rx="26"/>
        <rect class="buffer-slot" data-buffer-slot="1" x="453" y="229" width="58" height="72" rx="13"/>
        <rect class="buffer-slot" data-buffer-slot="2" x="531" y="229" width="58" height="72" rx="13"/>
        <rect class="buffer-slot" data-buffer-slot="3" x="609" y="229" width="58" height="72" rx="13"/>
        ${textLines(mode.channelLabel || mode.label, 560, 371, { max: 14, lines: 1, className: "channel-label" })}
      </g>`;
  }
  if (mode?.kind === "remote") {
    return `<path data-motion-track id="scene-motion-track" d="M260 245 C375 245 440 245 520 245 C600 245 675 245 860 245" class="mechanism-path" marker-end="url(#arrowViolet)"/>
      <path d="M860 302 C720 302 650 302 590 302 C510 302 420 302 260 302" class="return-path" marker-end="url(#arrowCyan)"/>
      <g class="channel remote-channel" data-node-id="channel" data-phase-index="1"><ellipse cx="560" cy="274" rx="38" ry="86"/><ellipse cx="560" cy="274" rx="20" ry="68"/>${textLines(short(mode.channelLabel || "RPC", 9), 560, 392, { max: 9, lines: 1, className: "channel-label" })}</g>`;
  }
  if (mode?.kind === "shared") {
    return `<path data-motion-track id="scene-motion-track" d="M260 265 C350 265 390 265 454 265 L666 265 C730 265 770 265 860 265" class="mechanism-path" marker-end="url(#arrowViolet)"/>
      <g class="channel shared-channel" data-node-id="channel" data-phase-index="1"><ellipse cx="560" cy="265" rx="108" ry="70"/><path d="M490 250H630M490 278H630"/>${textLines(short(mode.channelLabel || "共享区域", 10), 560, 370, { max: 10, lines: 1, className: "channel-label" })}</g>`;
  }
  return `<path data-motion-track id="scene-motion-track" d="M260 265 C420 265 650 265 860 265" class="mechanism-path" marker-end="url(#arrowViolet)"/>
    <g class="channel direct-channel" data-node-id="channel" data-phase-index="1"><circle cx="560" cy="265" r="30"/><path d="M545 265H575M565 255L575 265L565 275"/>${textLines(short(mode?.channelLabel || "点对点", 10), 560, 340, { max: 10, lines: 1, className: "channel-label" })}</g>`;
}

function renderMechanism(scene, modeId) {
  const mode = scene.modes?.find((item) => item.id === modeId) || scene.modes?.find((item) => item.id === scene.defaultMode) || scene.modes?.[0];
  const left = scene.entities?.find((item) => item.role === "source") || { id: "actor-left", label: "来源" };
  const right = scene.entities?.find((item) => item.role === "target") || { id: "actor-right", label: "目标" };
  return `<svg class="semantic-svg mechanism-scene" viewBox="0 0 1120 560" role="img" aria-label="${escapeXml(scene.title)}" data-visual-type="mechanism" data-mode-kind="${escapeXml(mode?.kind || "direct")}">
    ${commonDefs()}
    <g class="semantic-grid"><path d="M120 446H1000"/><path d="M120 92H1000"/></g>
    ${actorMarkup(left, 170, "violet", 0)}
    ${actorMarkup(right, 950, "cyan", 3)}
    ${mechanismChannel(mode)}
    <g class="motion-token" data-motion-token><circle r="18"/><circle r="7"/></g>
    <g class="mechanism-evidence"><circle cx="560" cy="92" r="5"/>${textLines(short(mode?.evidence || mode?.label || "", 28), 560, 100, { max: 28, lines: 1, className: "evidence-label" })}</g>
  </svg>`;
}

function graphPositions(scene) {
  const nodes = (scene.nodes || []).filter((node) => node.role !== "root");
  const positions = new Map();
  if (scene.visualType === "cycle" || scene.visualType === "state") {
    const radius = nodes.length > 5 ? 196 : 178;
    nodes.forEach((node, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(1, nodes.length) - Math.PI / 2;
      positions.set(node.id, { x: 560 + Math.cos(angle) * radius, y: 278 + Math.sin(angle) * radius });
    });
  } else if (scene.visualType === "hierarchy") {
    nodes.forEach((node, index) => {
      const spread = nodes.length <= 1 ? 0 : index / (nodes.length - 1);
      positions.set(node.id, { x: 140 + spread * 840, y: 355 + Math.abs(index - (nodes.length - 1) / 2) * 22 });
    });
    positions.set("root", { x: 560, y: 130 });
  } else if (scene.visualType === "reveal") {
    nodes.forEach((node, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(1, nodes.length) - Math.PI / 2;
      const radius = index % 2 ? 205 : 168;
      positions.set(node.id, { x: 560 + Math.cos(angle) * radius, y: 278 + Math.sin(angle) * radius });
    });
  } else {
    nodes.forEach((node, index) => {
      const x = nodes.length <= 1 ? 560 : 150 + (index / (nodes.length - 1)) * 820;
      positions.set(node.id, { x, y: 280 + (index % 2 ? 74 : -54) });
    });
  }
  return positions;
}

function curvedPath(from, to, visualType) {
  if (visualType === "cycle" || visualType === "state") {
    const cx = 560;
    const cy = 278;
    const mx = (from.x + to.x) / 2;
    const my = (from.y + to.y) / 2;
    const controlX = mx + (mx - cx) * 0.32;
    const controlY = my + (my - cy) * 0.32;
    return `M${from.x} ${from.y} Q${controlX} ${controlY} ${to.x} ${to.y}`;
  }
  if (visualType === "hierarchy") {
    return `M${from.x} ${from.y} C${from.x} ${(from.y + to.y) / 2},${to.x} ${(from.y + to.y) / 2},${to.x} ${to.y}`;
  }
  return `M${from.x} ${from.y} C${from.x + 76} ${from.y},${to.x - 76} ${to.y},${to.x} ${to.y}`;
}

function renderGraph(scene) {
  const positions = graphPositions(scene);
  const paths = (scene.relations || scene.edges || []).map((relation, index) => {
    const from = positions.get(relation.source);
    const to = positions.get(relation.target);
    if (!from || !to) return "";
    const d = curvedPath(from, to, scene.visualType);
    return `<path ${index === 0 ? "data-motion-track id=\"scene-motion-track\"" : ""} data-edge-index="${index}" data-phase-index="${Math.min(index + 1, (scene.nodes || []).length - 1)}" d="${d}" class="semantic-edge" marker-end="url(#arrowViolet)"/>`;
  }).join("");
  const nodes = (scene.nodes || []).map((node, index) => {
    const point = positions.get(node.id);
    if (!point) return "";
    const isRoot = node.role === "root";
    const radius = isRoot ? 78 : scene.visualType === "state" ? 54 : 62;
    return `<g class="scene-entity graph-node ${isRoot ? "root-node" : ""}" data-node-id="${escapeXml(node.id)}" data-phase-index="${Math.max(0, isRoot ? 0 : (node.order || index) - 1)}" transform="translate(${point.x} ${point.y})">
      <circle class="node-halo" r="${radius + 15}"/><circle class="node-body" r="${radius}"/>
      ${textLines(node.label, 0, node.label.length > 9 ? -7 : 7, { max: 9, lines: 2, className: "graph-label", lineHeight: 19 })}
    </g>`;
  }).join("");
  const isClosed = scene.visualType === "cycle" || scene.visualType === "state";
  const track = isClosed ? `<circle id="scene-motion-track" data-motion-track class="invisible-track" cx="560" cy="278" r="${(scene.nodes || []).length > 5 ? 196 : 178}"/>` : "";
  return `<svg class="semantic-svg graph-scene ${escapeXml(scene.visualType)}-scene" viewBox="0 0 1120 560" role="img" aria-label="${escapeXml(scene.title)}" data-visual-type="${escapeXml(scene.visualType)}">
    ${commonDefs()}<g class="semantic-grid"><path d="M90 466H1030"/><path d="M90 92H1030"/></g>${track}${paths}${nodes}<g class="motion-token" data-motion-token><circle r="16"/><circle r="6"/></g>
  </svg>`;
}

function renderFlow(scene) {
  const nodes = (scene.nodes || []).filter((node) => node.role !== "root").slice(0, 5);
  const positions = nodes.map((node, index) => ({
    node,
    x: nodes.length <= 1 ? 560 : 140 + (index / (nodes.length - 1)) * 840,
    y: index % 2 ? 340 : 210,
  }));
  const path = positions.map((point, index) => `${index ? "L" : "M"}${point.x} ${point.y}`).join(" ");
  const cards = positions.map(({ node, x, y }, index) => `<g class="scene-entity flow-step" data-node-id="${escapeXml(node.id)}" data-phase-index="${index}" transform="translate(${x} ${y})">
    <circle class="step-number" cx="0" cy="-60" r="20"/><text class="step-number-label" x="0" y="-54" text-anchor="middle">${index + 1}</text>
    <rect class="flow-card" x="-72" y="-40" width="144" height="80" rx="22"/>
    ${textLines(node.label, 0, 7, { max: 8, lines: 1, className: "graph-label" })}
  </g>`).join("");
  return `<svg class="semantic-svg flow-scene" viewBox="0 0 1120 560" role="img" aria-label="${escapeXml(scene.title)}" data-visual-type="flow">${commonDefs()}
    <path class="flow-track-shadow" d="${path}"/><path id="scene-motion-track" data-motion-track class="flow-track" d="${path}" marker-end="url(#arrowViolet)"/>
    ${cards}<g class="motion-token" data-motion-token><circle r="16"/><circle r="6"/></g>
  </svg>`;
}

function causeDepths(scene) {
  const relations = scene.relations || [];
  const nodes = scene.nodes || [];
  const depth = new Map(nodes.map((node) => [node.id, 0]));
  for (let pass = 0; pass < nodes.length; pass += 1) {
    for (const relation of relations) {
      depth.set(relation.target, Math.max(depth.get(relation.target) || 0, (depth.get(relation.source) || 0) + 1));
    }
  }
  return depth;
}

function renderCause(scene) {
  const nodes = (scene.nodes || []).slice(0, 6);
  const relations = scene.relations || [];
  const depths = causeDepths(scene);
  const maxDepth = Math.max(1, ...depths.values());
  const columns = new Map();
  nodes.forEach((node) => {
    const key = depths.get(node.id) || 0;
    if (!columns.has(key)) columns.set(key, []);
    columns.get(key).push(node);
  });
  const positions = new Map();
  for (const [column, columnNodes] of columns) {
    columnNodes.forEach((node, index) => positions.set(node.id, {
      x: 150 + (column / maxDepth) * 820,
      y: 150 + ((index + 1) / (columnNodes.length + 1)) * 280,
    }));
  }
  const paths = relations.map((relation, index) => {
    const from = positions.get(relation.source); const to = positions.get(relation.target);
    if (!from || !to) return "";
    return `<path ${index === 0 ? "id=\"scene-motion-track\" data-motion-track" : ""} class="cause-edge" data-phase-index="${Math.min(index + 1, nodes.length - 1)}" d="M${from.x + 58} ${from.y} C${from.x + 120} ${from.y},${to.x - 120} ${to.y},${to.x - 64} ${to.y}" marker-end="url(#arrowViolet)"/>`;
  }).join("");
  const markup = nodes.map((node, index) => {
    const point = positions.get(node.id); const isEffect = relations.some((relation) => relation.target === node.id);
    return `<g class="scene-entity cause-node ${isEffect ? "effect" : "origin"}" data-node-id="${escapeXml(node.id)}" data-phase-index="${Math.max(0, index)}" transform="translate(${point.x} ${point.y})">
      ${isEffect ? '<rect class="cause-body" x="-64" y="-45" width="128" height="90" rx="26"/>' : '<circle class="cause-body" r="54"/>'}
      ${textLines(node.label, 0, 6, { max: 8, lines: 1, className: "graph-label" })}
    </g>`;
  }).join("");
  return `<svg class="semantic-svg cause-scene" viewBox="0 0 1120 560" role="img" aria-label="${escapeXml(scene.title)}" data-visual-type="cause">${commonDefs()}
    <g class="cause-caption"><text x="150" y="74">起因</text><text x="970" y="74" text-anchor="end">结果</text></g>${paths}${markup}<g class="motion-token" data-motion-token><circle r="16"/><circle r="6"/></g>
  </svg>`;
}

function renderHierarchy(scene) {
  const root = (scene.nodes || []).find((node) => node.role === "root") || scene.nodes?.[0];
  const children = (scene.nodes || []).filter((node) => node.id !== root?.id).slice(0, 5);
  const childPositions = children.map((node, index) => ({ node, x: 130 + ((index + 0.5) / children.length) * 860, y: 365 + (index % 2) * 40 }));
  const branches = childPositions.map(({ x, y }, index) => `<path ${index === 0 ? "id=\"scene-motion-track\" data-motion-track" : ""} class="hierarchy-branch" data-phase-index="${index}" d="M560 190 C560 260,${x} 260,${x} ${y - 52}" marker-end="url(#arrowViolet)"/>`).join("");
  const parts = childPositions.map(({ node, x, y }, index) => `<g class="scene-entity hierarchy-part" data-node-id="${escapeXml(node.id)}" data-phase-index="${index}" transform="translate(${x} ${y})"><rect x="-72" y="-44" width="144" height="88" rx="22"/>${textLines(node.label, 0, 6, { max: 8, lines: 1, className: "graph-label" })}</g>`).join("");
  return `<svg class="semantic-svg hierarchy-scene" viewBox="0 0 1120 560" role="img" aria-label="${escapeXml(scene.title)}" data-visual-type="hierarchy">${commonDefs()}
    <g class="scene-entity hierarchy-root is-visible" data-node-id="${escapeXml(root?.id || "root")}" data-phase-index="0" transform="translate(560 130)"><circle r="76"/><circle class="root-orbit" r="92"/>${textLines(root?.label || scene.title, 0, 6, { max: 8, lines: 1, className: "root-label" })}</g>
    ${branches}${parts}<g class="motion-token" data-motion-token><circle r="16"/><circle r="6"/></g>
  </svg>`;
}

function renderAllocation(scene) {
  const nodes = scene.nodes || [];
  const actors = nodes.filter((node) => node.role === "actor");
  const resources = nodes.filter((node) => node.role === "resource");
  const positions = new Map();
  actors.forEach((node, index) => positions.set(node.id, { x: 245, y: 150 + ((index + 1) / (actors.length + 1)) * 300 }));
  resources.forEach((node, index) => positions.set(node.id, { x: 875, y: 150 + ((index + 1) / (resources.length + 1)) * 300 }));
  const relations = (scene.relations || []).map((relation, index) => {
    const from = positions.get(relation.source); const to = positions.get(relation.target);
    if (!from || !to) return "";
    const className = relation.type === "holds" ? "allocation-edge holds" : "allocation-edge requests";
    return `<path ${index === 0 ? "id=\"scene-motion-track\" data-motion-track" : ""} class="${className}" data-phase-index="${Math.min(index + 1, nodes.length - 1)}" d="M${from.x + 58} ${from.y} C430 ${from.y},690 ${to.y},${to.x - 58} ${to.y}" marker-end="url(#${relation.type === "holds" ? "arrowCyan" : "arrowViolet"})"/>`;
  }).join("");
  const actorMarkup = actors.map((node, index) => { const p = positions.get(node.id); return `<g class="scene-entity allocation-node actor-node" data-node-id="${escapeXml(node.id)}" data-phase-index="${index}" transform="translate(${p.x} ${p.y})"><circle r="54"/>${textLines(node.label, 0, 6, { max: 8, lines: 1, className: "graph-label" })}</g>`; }).join("");
  const resourceMarkup = resources.map((node, index) => { const p = positions.get(node.id); return `<g class="scene-entity allocation-node resource-node" data-node-id="${escapeXml(node.id)}" data-phase-index="${index + actors.length}" transform="translate(${p.x} ${p.y})"><rect x="-55" y="-55" width="110" height="110" rx="18"/><path d="M-34 -18H34M-34 0H34M-34 18H18"/>${textLines(node.label, 0, 78, { max: 8, lines: 1, className: "graph-label" })}</g>`; }).join("");
  return `<svg class="semantic-svg allocation-scene" viewBox="0 0 1120 560" role="img" aria-label="${escapeXml(scene.title)}" data-visual-type="allocation">${commonDefs()}<g class="allocation-caption"><text x="245" y="72" text-anchor="middle">请求者</text><text x="875" y="72" text-anchor="middle">资源</text></g>${relations}${actorMarkup}${resourceMarkup}<g class="motion-token" data-motion-token><circle r="16"/><circle r="6"/></g></svg>`;
}

function renderTrajectory(scene) {
  const values = (scene.values?.length ? scene.values : (scene.nodes || []).map((node) => Number(node.label))).filter(Number.isFinite).slice(0, 8);
  const min = Math.min(...values); const max = Math.max(...values); const span = Math.max(1, max - min);
  const point = (value, index) => ({ x: 150 + ((value - min) / span) * 820, y: 120 + index * (350 / Math.max(1, values.length - 1)) });
  const points = values.map(point);
  const path = points.map((p, index) => `${index ? "L" : "M"}${p.x} ${p.y}`).join(" ");
  const ticks = Array.from({ length: 6 }, (_, index) => { const value = min + (span * index) / 5; const x = 150 + (820 * index) / 5; return `<g class="trajectory-tick"><path d="M${x} 86V492"/><text x="${x}" y="522" text-anchor="middle">${Number(value.toFixed(1))}</text></g>`; }).join("");
  const markers = points.map((p, index) => `<g class="scene-entity trajectory-point" data-phase-index="${index}" transform="translate(${p.x} ${p.y})"><circle r="17"/><text x="0" y="6" text-anchor="middle">${escapeXml(values[index])}</text><text class="trajectory-step" x="-30" y="6" text-anchor="end">${index + 1}</text></g>`).join("");
  return `<svg class="semantic-svg trajectory-scene" viewBox="0 0 1120 560" role="img" aria-label="${escapeXml(scene.title)}" data-visual-type="trajectory">${commonDefs()}${ticks}<path class="trajectory-shadow" d="${path}"/><path id="scene-motion-track" data-motion-track class="trajectory-path" d="${path}" marker-end="url(#arrowViolet)"/>${markers}<g class="motion-token" data-motion-token><circle r="16"/><circle r="6"/></g></svg>`;
}

function renderComparison(scene) {
  const groups = scene.groups?.slice(0, 2) || [];
  const nodes = scene.nodes || [];
  const groupMarkup = groups.map((group, groupIndex) => {
    const x = groupIndex ? 790 : 330;
    const color = groupIndex ? "cyan" : "violet";
    const items = nodes.filter((node) => group.nodeIds.includes(node.id)).slice(0, 4);
    const traits = items.map((node, index) => {
      const y = 260 + index * 62;
      return `<g class="scene-entity compare-trait" data-node-id="${escapeXml(node.id)}" data-phase-index="${node.order - 1}"><circle cx="${x - 126}" cy="${y}" r="7"/><path d="M${x - 108} ${y}H${x - 74}"/>${textLines(node.label, x, y + 6, { max: 16, lines: 1, className: "compare-label" })}</g>`;
    }).join("");
    return `<g class="compare-group ${color}"><circle class="group-halo" cx="${x}" cy="150" r="74"/><circle class="group-core" cx="${x}" cy="150" r="54"/>${textLines(group.label, x, 157, { max: 9, lines: 1, className: "group-label" })}<path class="group-spine" d="M${x} 226V476"/>${traits}</g>`;
  }).join("");
  return `<svg class="semantic-svg comparison-scene" viewBox="0 0 1120 560" role="img" aria-label="${escapeXml(scene.title)}" data-visual-type="comparison">${commonDefs()}<g class="semantic-grid"><path d="M90 486H1030"/><path d="M560 88V486"/></g>${groupMarkup}<g class="compare-axis"><circle cx="560" cy="150" r="24"/><path d="M548 150H572M560 138V162"/></g></svg>`;
}

export function renderScene(scene, { modeId } = {}) {
  // Older saved units can contain valid generated SVG without the newer
  // renderer marker. Treat the artifact itself as the source of truth so a
  // playable resource never degrades into the empty-scene placeholder.
  if (scene?.svgMarkup) {
    // Model-produced markup is validated server-side and displayed without
    // scripts. It is deliberately not passed through any category template.
    return safeSvg(scene.svgMarkup) || '<p class="runtime-warning">动效包含不安全内容，已阻止显示。</p>';
  }
  if (!scene?.nodes?.length) return `<div class="scene-empty">当前内容不足以形成可视化场景。</div>`;
  if (scene.visualType === "mechanism") return renderMechanism(scene, modeId || scene.defaultMode);
  if (scene.visualType === "comparison") return renderComparison(scene);
  if (scene.visualType === "flow") return renderFlow(scene);
  if (scene.visualType === "cause") return renderCause(scene);
  if (scene.visualType === "hierarchy") return renderHierarchy(scene);
  if (scene.visualType === "allocation") return renderAllocation(scene);
  if (scene.visualType === "trajectory") return renderTrajectory(scene);
  return renderGraph(scene);
}

function pointOnPath(path, progress) {
  try {
    const length = path.getTotalLength();
    return path.getPointAtLength(clamp(progress) * length);
  } catch {
    return null;
  }
}

export function applySceneProgress(container, scene, progress, { modeId } = {}) {
  const value = clamp(progress);
  const phases = scenePhases(scene, modeId);
  if (scene?.renderer === "ai-svg" || scene?.svgMarkup) {
    let activeIndex = 0;
    phases.forEach((phase, index) => { if (value + 0.001 >= (phase.at ?? index / Math.max(1, phases.length - 1))) activeIndex = index; });
    const svg = container.querySelector("svg");
    if (svg) {
      svg.style.width = "100%"; svg.style.height = "auto"; svg.style.maxWidth = "100%";
      svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
      // Explicit phase groups are exclusive; ordinary phase-index nodes remain cumulative.
      svg.querySelectorAll("[data-phase-index], .phase-group").forEach(element => {
        const index = Number(element.dataset.phaseIndex ?? element.dataset.phase ?? [...element.classList].join(" ").match(/phase(\\d+)/)?.[1]);
        if (!Number.isFinite(index)) return;
        const exclusive = element.classList.contains("phase-group") || element.dataset.phaseMode === "exclusive";
        const visible = exclusive ? index === activeIndex : index <= activeIndex;
        element.classList.toggle("active", index === activeIndex);
        element.classList.toggle("is-active", index === activeIndex);
        element.classList.toggle("is-visible", visible);
        if (exclusive) element.style.setProperty("display", visible ? "inline" : "none", "important");
      });
      const seconds = value * (scene.totalDurationMs || 9000) / 1000;
      svg.pauseAnimations?.();
      svg.setCurrentTime?.(seconds);
      for (const animation of svg.getAnimations?.({ subtree: true }) || []) {
        animation.pause();
        animation.currentTime = seconds * 1000;
      }
    }
    return { activeIndex, activePhase: phases[activeIndex], phases };
  }
  let activeIndex = 0;
  phases.forEach((phase, index) => {
    if (value + 0.001 >= (phase.at ?? index / Math.max(1, phases.length - 1))) activeIndex = index;
  });
  container.querySelectorAll("[data-phase-index]").forEach((element) => {
    const index = Number(element.dataset.phaseIndex || 0);
    element.classList.toggle("is-visible", index <= activeIndex);
    element.classList.toggle("is-active", index === activeIndex);
  });

  const svg = container.querySelector("svg");
  const path = svg?.querySelector("[data-motion-track]");
  const token = svg?.querySelector("[data-motion-token]");
  if (path && token) {
    let trackProgress = value;
    const mode = scene.modes?.find((item) => item.id === modeId) || scene.modes?.find((item) => item.id === scene.defaultMode);
    if (scene.visualType === "mechanism" && mode?.kind === "buffer") {
      if (value < 0.34) trackProgress = (value / 0.34) * 0.42;
      else if (value < 0.62) trackProgress = 0.42;
      else trackProgress = 0.42 + ((value - 0.62) / 0.38) * 0.58;
    }
    const point = pointOnPath(path, trackProgress);
    if (point) token.setAttribute("transform", `translate(${point.x} ${point.y})`);
    token.classList.toggle("is-waiting", scene.visualType === "mechanism" && mode?.kind === "buffer" && value >= 0.34 && value < 0.62);
  }

  container.querySelectorAll("[data-buffer-slot]").forEach((slot, index) => {
    slot.classList.toggle("is-filled", index === 0 && value >= 0.28 && value < 0.72);
  });
  return { activeIndex, activePhase: phases[activeIndex], phases };
}

export function standaloneSvg(scene, options = {}) {
  if (scene?.svgMarkup) return `<?xml version="1.0" encoding="UTF-8"?>\n${scene.svgMarkup}`;
  const duration = scene?.totalDurationMs || 5000;
  const embeddedStyle = `<style>
    text{font-family:system-ui,"PingFang SC","Microsoft YaHei",sans-serif}.semantic-grid path{fill:none;stroke:#e3e8f2;stroke-width:1;stroke-dasharray:3 9}.actor-halo,.node-halo,.group-halo{fill:none;stroke:#795ff0;stroke-width:1.5;stroke-dasharray:4 5;opacity:.2}.actor-ring{fill:#fff;stroke:#d8dfed;stroke-width:2}.actor-screen{fill:#fff}.actor-stand{fill:none;stroke:#fff;stroke-width:5;stroke-linecap:round}.actor-label,.graph-label,.group-label,.root-label{font-weight:750;fill:#17203a}.mechanism-path,.return-path,.semantic-edge,.flow-track,.cause-edge,.hierarchy-branch,.allocation-edge,.trajectory-path{fill:none;stroke:#755ae9;stroke-width:4;stroke-linecap:round}.return-path,.allocation-edge.holds{stroke:#1bb7dd}.channel rect,.channel ellipse{fill:#fff;stroke:#bdc8dc;stroke-width:2}.channel path{fill:none;stroke:#71809c;stroke-width:3}.buffer-slot{fill:#f7f8fc;stroke-dasharray:5 4}.channel-label,.evidence-label{font-size:14px;fill:#64718b}.motion-token circle:first-child{fill:#fff;stroke:#7358e9;stroke-width:6}.motion-token circle:last-child{fill:#20bde7}.node-body,.flow-card,.cause-body,.hierarchy-part rect{fill:#fff;stroke:#cbd5e6;stroke-width:2}.root-node .node-body,.hierarchy-root>circle:first-child{fill:#6f55df}.root-node .graph-label,.hierarchy-root .root-label{fill:#fff}.root-orbit{fill:none;stroke:#795ff0;stroke-dasharray:5 7}.invisible-track{fill:none;stroke:none}.group-core{fill:#fff;stroke:#7358e9;stroke-width:3}.cyan .group-core{stroke:#1bb7dd}.group-spine,.compare-trait path{fill:none;stroke:#d2daea;stroke-width:2}.compare-trait circle,.step-number,.trajectory-point circle{fill:#7358e9}.step-number-label,.trajectory-point>text:not(.trajectory-step){fill:#fff;font-weight:800}.compare-label{font-size:15px;fill:#34415e}.cause-caption,.allocation-caption{font-size:14px;font-weight:700;fill:#7b86a0}.allocation-node.actor-node circle{fill:#fff;stroke:#7358e9;stroke-width:3}.allocation-node.resource-node rect{fill:#eefbff;stroke:#20bce7;stroke-width:3}.allocation-node.resource-node path{fill:none;stroke:#20bce7;stroke-width:4}.trajectory-tick path{stroke:#e0e6f1;stroke-width:1}.trajectory-tick text,.trajectory-step{fill:#7b86a0;font-size:13px}.trajectory-shadow,.flow-track-shadow{fill:none;stroke:#e9e6fb;stroke-width:16;stroke-linecap:round}.trajectory-path{stroke-width:4}.cause-node.effect .cause-body{fill:#f0edff;stroke:#7358e9}
  </style>`;
  let markup = renderScene(scene, options).replace("</defs>", `${embeddedStyle}</defs>`);
  markup = markup.replace(/(<g class="motion-token"[^>]*>)/, `$1<animateMotion dur="${duration}ms" repeatCount="indefinite" rotate="auto"><mpath href="#scene-motion-track"/></animateMotion>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${markup}`;
}
