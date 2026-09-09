const visualTypeLabels = {
  mechanism: "机制模拟",
  state: "状态迁移",
  comparison: "结构对比",
  cycle: "循环系统",
  cause: "因果传导",
  hierarchy: "层级结构",
  flow: "过程演进",
  reveal: "概念建模",
  allocation: "分配网络",
  trajectory: "轨迹演示",
};

const visualReasons = {
  mechanism: "突出对象、媒介与传递路径，观察信息或作用如何到达目标。",
  state: "突出同一对象的状态变化及触发方向。",
  comparison: "只保留可对齐的对象与维度，在统一尺度下比较。",
  cycle: "突出闭环、反馈或周期中的阶段回返。",
  cause: "仅呈现能从课件语句中找到依据的因果方向。",
  hierarchy: "把整体、类别与组成部分组织为空间层级。",
  flow: "把有明确顺序的阶段组织为可追踪的路径。",
  reveal: "先建立核心概念，再揭示与其直接相关的要素。",
  allocation: "用两类对象和连接关系表现请求、占用或分配。",
  trajectory: "把数值、位置或次序映射到坐标路径，直接观察变化。",
};

function normalizeLine(value = "") {
  return String(value)
    .replace(/^[\s•·▪▫◆◇●○▸▹①-⑳\-]+/, "")
    .replace(/^[0-9]+[、．）)]\s*/, "")
    .replace(/^[0-9]+\.(?!\d)\s*/, "")
    .replace(/^[一二三四五六七八九十]+[.、．）)]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function canonical(value = "") {
  return normalizeLine(value).replace(/[\s，。；：、,.!?！？“”"'()（）]/g, "").toLowerCase();
}

function compactLabel(value, maxLength = 8) {
  let text = normalizeLine(value)
    .replace(/^\d+(?:\.\d+)+(?:\s*)/, "")
    .replace(/^(所谓|其中|因此|所以|由于|可以看出|由此可见)/, "")
    .replace(/[。；;，,]+$/, "")
    .trim();
  const definition = text.match(/^(.{2,12}?)(?:是指|是|指的是)/)?.[1];
  if (definition) text = definition;
  const firstClause = text.split(/[。；;：:！？!?，,]/)[0].trim();
  if (firstClause.length >= 2 && firstClause.length < text.length) text = firstClause;
  if (text.length <= maxLength) return text;
  const nounTail = text.match(/([^的，。；]{2,8})(?:的)?(?:过程|状态|结构|系统|机制|算法|方法|条件|因素|结果|资源|对象)$/)?.[0];
  if (nounTail && nounTail.length <= maxLength) return nounTail;
  return `${text.slice(0, Math.max(2, maxLength - 1))}…`;
}

function uniqueConcepts(items = [], limit = 6) {
  const concepts = [];
  const seen = new Set();
  for (const raw of items) {
    const text = normalizeLine(raw);
    if (!text) continue;
    const clauses = text.split(/[；;。]/).map((item) => item.trim()).filter((item) => item.length >= 2);
    for (const clause of clauses.length ? clauses : [text]) {
      const label = compactLabel(clause, 8);
      const key = canonical(label);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      concepts.push({ label, detail: clause.length > label.length ? clause.slice(0, 96) : "", evidence: clause });
      if (concepts.length >= limit) return concepts;
    }
  }
  return concepts;
}

function hasNumbers(text) {
  return (String(text).match(/-?\d+(?:\.\d+)?/g) || []).length >= 3;
}

export function inferVisualType(motion) {
  const title = motion.title || "";
  const text = `${title}\n${(motion.items || []).join("\n")}`;
  const cycleText = text.replace(/无循环|不存在循环|非循环|禁止循环|避免循环/g, "");
  if (hasNumbers(text) && /轨迹|位置|距离|坐标|移动|变化曲线|调度顺序|访问顺序/.test(text)) return "trajectory";
  if (/(?:请求|持有|占用|分配|等待).{0,10}(?:资源|设备|空间|锁|对象)|(?:资源|设备|空间|锁).{0,10}(?:请求|持有|占用|分配|等待)/.test(text)) return "allocation";
  const hasTransfer = /传递|传输|流动|交换|输入|输出|发送|接收|连接|调用|作用/.test(text);
  const hasMedium = /通过|借助|经由|媒介|介质|通道|中介|缓冲|队列|共享|容器|平台/.test(text);
  if (hasTransfer && (hasMedium || /类型|方式|机制|路径|通道/.test(title))) return "mechanism";
  if (/(?:\d+|[一二三四五六七八九十]+)类|分类|分为|包括|组成|层次|结构|体系|必要条件/.test(title)) return "hierarchy";
  if (/状态|转换|迁移|状态机/.test(text)) return "state";
  if (/对比|比较|区别|异同|\bvs\.?\b/i.test(title)) return "comparison";
  if (/循环|周期|轮转|生命周期|反馈|往复/.test(cycleText)) return "cycle";
  if (/原因|导致|引起|造成|因此|结果|影响|依赖|促进|抑制/.test(text)) return "cause";
  if (/分类|分为|包括|组成|层次|结构|体系|必要条件/.test(text)) return "hierarchy";
  if (/步骤|流程|过程|阶段|首先|然后|接着|最后|执行顺序|算法/.test(text)) return "flow";
  if (/对比|比较|区别|异同|相同|不同|优点|缺点|\bvs\.?\b/i.test(text)) return "comparison";
  return ["comparison", "cycle", "cause", "hierarchy", "flow", "state", "allocation", "trajectory"].includes(motion.type)
    ? motion.type
    : "reveal";
}

function nodeFrom(concept, index, role = "concept", id = `node-${index + 1}`) {
  return {
    id,
    label: compactLabel(concept.label || concept.evidence, 8),
    detail: String(concept.detail || "").slice(0, 96),
    evidence: String(concept.evidence || concept.label || "").slice(0, 180),
    order: index + 1,
    role,
    kind: role,
  };
}

function sequenceFor(nodes, relations, action = "reveal") {
  const visibleNodes = nodes.filter((node) => node.role !== "root");
  return visibleNodes.map((node, index) => ({
    id: `phase-${index + 1}`,
    label: compactLabel(node.label, 6),
    action,
    focusIds: [node.id],
    relationId: relations.find((relation) => relation.target === node.id)?.id || null,
    at: visibleNodes.length <= 1 ? 0 : index / (visibleNodes.length - 1),
  }));
}

function entityRegistry() {
  const nodes = [];
  const byKey = new Map();
  return {
    nodes,
    add(label, evidence, role = "concept") {
      const compact = compactLabel(label, 8);
      const key = canonical(compact);
      if (!key) return null;
      if (byKey.has(key)) return byKey.get(key);
      if (nodes.length >= 6) return null;
      const node = nodeFrom({ label: compact, evidence }, nodes.length, role);
      nodes.push(node);
      byKey.set(key, node);
      return node;
    },
  };
}

function causePlan(motion) {
  const registry = entityRegistry();
  const relations = [];
  const addRelation = (cause, effect, evidence) => {
    const source = registry.add(cause, evidence, "cause");
    const target = registry.add(effect, evidence, "effect");
    if (!source || !target || source.id === target.id) return;
    if (relations.some((item) => item.source === source.id && item.target === target.id)) return;
    relations.push({ id: `rel-${relations.length + 1}`, source: source.id, target: target.id, type: "causes", label: "导致", evidence });
  };
  for (const raw of motion.items || []) {
    const text = normalizeLine(raw);
    let match = text.match(/^(.{2,34}?)是(?:引起|导致|造成)?(.{2,34}?)的(?:根本|主要|直接|间接)?原因/);
    if (match) { addRelation(match[1], match[2], text); continue; }
    match = text.match(/^由于(.{2,34}?)[，,](?:因此|所以)?(.{2,40})/);
    if (match) { addRelation(match[1], match[2], text); continue; }
    match = text.match(/^(.{2,34}?)(?:会|将|可|可能)?(?:导致|引起|造成|促进|抑制|影响|决定)(.{2,40})/);
    if (match) addRelation(match[1], match[2], text);
  }
  if (!relations.length) return null;
  return { nodes: registry.nodes, entities: registry.nodes, relations, edges: relations, groups: [], phases: sequenceFor(registry.nodes, relations, "propagate") };
}

function hierarchyPlan(motion, concepts) {
  let rootLabel = compactLabel(motion.title, 8);
  let children = [];
  for (const raw of motion.items || []) {
    const text = normalizeLine(raw);
    const match = text.match(/^(.{2,20}?)(?:包括|包含|分为|可分为|由)(.{3,80}?)(?:组成)?$/);
    if (!match) continue;
    rootLabel = compactLabel(match[1], 8);
    children = match[2].split(/[、，,；;]|以及|及|和|与/).map((item) => item.trim()).filter((item) => item.length >= 2);
    if (children.length >= 2) break;
  }
  if (children.length < 2) children = concepts.map((item) => item.label).filter((item) => canonical(item) !== canonical(rootLabel));
  children = [...new Set(children.map((item) => compactLabel(item, 8)))].slice(0, 5);
  if (children.length < 2) return null;
  const root = nodeFrom({ label: rootLabel, evidence: motion.title }, 0, "root", "root");
  root.order = 0;
  const nodes = children.map((label, index) => nodeFrom({ label, evidence: (motion.items || []).find((item) => item.includes(label)) || label }, index, "part"));
  const relations = nodes.map((node, index) => ({ id: `rel-${index + 1}`, source: root.id, target: node.id, type: "contains", label: "包含", evidence: node.evidence }));
  return { nodes: [root, ...nodes], entities: [root, ...nodes], relations, edges: relations, groups: [], phases: sequenceFor(nodes, relations, "expand") };
}

function comparisonSubjects(motion) {
  const title = String(motion.title || "").replace(/[（(]?\d+[）)]?$/, "");
  const parts = title.split(/比较|对比|区别|异同|和|与|及|、|vs\.?/i).map((item) => compactLabel(item, 8)).filter((item) => item.length >= 2);
  if (parts.length >= 2) return parts.slice(-2);
  const headings = (motion.items || [])
    .map((item) => normalizeLine(item).match(/^([^：:]{2,10})[：:]/)?.[1])
    .filter(Boolean);
  return [...new Set(headings)].slice(0, 2);
}

function comparisonPlan(motion, concepts) {
  const subjects = comparisonSubjects(motion);
  if (subjects.length < 2) return null;
  const groups = subjects.map((label, index) => ({ id: `group-${index + 1}`, label, nodeIds: [] }));
  const nodes = [];
  for (const concept of concepts) {
    const text = `${concept.label}${concept.detail}${concept.evidence}`;
    const groupIndex = subjects.findIndex((subject) => text.includes(subject));
    if (groupIndex < 0) continue;
    const cleaned = normalizeLine(text.replaceAll(subjects[groupIndex], "").replace(/^[：:，,\s]+/, ""));
    const label = compactLabel(cleaned || concept.label, 8);
    if (!label || canonical(label) === canonical(subjects[groupIndex])) continue;
    const node = nodeFrom({ ...concept, label }, nodes.length, "trait");
    node.groupId = groups[groupIndex].id;
    groups[groupIndex].nodeIds.push(node.id);
    nodes.push(node);
    if (nodes.length >= 6) break;
  }
  if (groups.some((group) => !group.nodeIds.length)) return null;
  return { nodes, entities: nodes, relations: [], edges: [], groups, phases: sequenceFor(nodes, [], "compare") };
}

function orderedPlan(motion, concepts, visualType) {
  const source = (motion.items || []).map(normalizeLine).filter(Boolean);
  if (visualType === "cycle") {
    const cycleEvidence = source.filter((item) => /循环|周期|轮转|反馈|往复|回到|返回起点/.test(item)).length;
    if (cycleEvidence < 2 && !/循环|周期|轮转|反馈|往复/.test(motion.title || "")) return null;
  }
  const hasOrderEvidence = source.filter((item) => /^(首先|然后|接着|随后|最后|第[一二三四五六七八九十\d]+)|步骤|阶段/.test(item)).length >= 1
    || source.filter((item) => item.length <= 14).length >= 3;
  if (!hasOrderEvidence || concepts.length < 3) return null;
  const limit = visualType === "cycle" ? 6 : 5;
  const nodes = concepts.slice(0, limit).map((concept, index) => nodeFrom(concept, index, visualType === "state" ? "state" : "step"));
  const type = visualType === "state" ? "transitions" : visualType === "cycle" ? "cycles" : "next";
  const relations = nodes.slice(1).map((node, index) => ({ id: `rel-${index + 1}`, source: nodes[index].id, target: node.id, type, label: type === "transitions" ? "迁移" : "推进", evidence: node.evidence }));
  if (visualType === "cycle" && nodes.length > 2) relations.push({ id: `rel-${relations.length + 1}`, source: nodes.at(-1).id, target: nodes[0].id, type: "cycles", label: "回到起点", evidence: motion.title });
  return { nodes, entities: nodes, relations, edges: relations, groups: [], phases: sequenceFor(nodes, relations, visualType === "state" ? "transition" : "advance") };
}

function allocationPlan(motion) {
  const registry = entityRegistry();
  const relations = [];
  for (const raw of motion.items || []) {
    const text = normalizeLine(raw);
    const match = text.match(/^(.+?)(请求|申请|持有|占用|获得|使用|分配给|等待)(.{2,30})/);
    if (!match) continue;
    const actorMatches = [...match[1].matchAll(/(?:进程|任务|用户|节点|程序|系统|对象|主体)[A-Za-z0-9一二三四五六七八九十]*/g)];
    const resourceMatches = [...match[3].matchAll(/(?:共享)?(?:资源|设备|空间|锁|文件|内存|数据|通道)(?:[A-Za-z0-9一二三四五六七八九十]+)?/g)];
    const actorLabel = actorMatches.at(-1)?.[0];
    const resourceLabel = resourceMatches[0]?.[0];
    if (!actorLabel || !resourceLabel) continue;
    const source = registry.add(actorLabel, text, "actor");
    const target = registry.add(resourceLabel, text, "resource");
    if (!source || !target || source.id === target.id) continue;
    relations.push({ id: `rel-${relations.length + 1}`, source: source.id, target: target.id, type: /持有|占用|获得|使用|分配给/.test(match[2]) ? "holds" : "requests", label: /等待/.test(match[2]) ? "等待" : match[2], evidence: text });
  }
  if (relations.length < 1 || !registry.nodes.some((node) => node.role === "actor") || !registry.nodes.some((node) => node.role === "resource")) return null;
  return { nodes: registry.nodes, entities: registry.nodes, relations, edges: relations, groups: [], phases: sequenceFor(registry.nodes, relations, "allocate") };
}

function trajectoryPlan(motion) {
  const values = [];
  for (const raw of motion.items || []) {
    for (const match of String(raw).matchAll(/-?\d+(?:\.\d+)?/g)) {
      const value = Number(match[0]);
      if (Number.isFinite(value)) values.push({ value, evidence: normalizeLine(raw) });
      if (values.length >= 8) break;
    }
    if (values.length >= 8) break;
  }
  if (values.length < 3) return null;
  const nodes = values.map((item, index) => nodeFrom({ label: String(item.value), evidence: item.evidence }, index, "position"));
  const relations = nodes.slice(1).map((node, index) => ({ id: `rel-${index + 1}`, source: nodes[index].id, target: node.id, type: "moves", label: "移动", evidence: node.evidence }));
  return { nodes, entities: nodes, relations, edges: relations, groups: [], values: values.map((item) => item.value), phases: sequenceFor(nodes, relations, "move") };
}

function revealPlan(motion, concepts) {
  const root = nodeFrom({ label: compactLabel(motion.title, 8), evidence: motion.title }, 0, "root", "root");
  root.order = 0;
  const nodes = concepts.filter((item) => canonical(item.label) !== canonical(root.label)).slice(0, 5).map((concept, index) => nodeFrom(concept, index, "concept"));
  if (!nodes.length) nodes.push(nodeFrom({ label: root.label, evidence: motion.title }, 0, "concept"));
  const relations = nodes.map((node, index) => ({ id: `rel-${index + 1}`, source: root.id, target: node.id, type: "related", label: "关联", evidence: node.evidence }));
  return { nodes: [root, ...nodes], entities: [root, ...nodes], relations, edges: relations, groups: [], phases: sequenceFor(nodes, relations, "reveal") };
}

function mechanismPlan(motion, concepts, hinted) {
  const source = (motion.items || []).map(normalizeLine);
  const modeRules = [
    { id: "mode-direct", kind: "direct", pattern: /直接|点对点|一对一/ },
    { id: "mode-buffer", kind: "buffer", pattern: /间接|中介|队列|缓冲|存储|容器|池/ },
    { id: "mode-shared", kind: "shared", pattern: /共享|共用|公共/ },
    { id: "mode-request", kind: "remote", pattern: /远程|请求|响应|调用|服务/ },
  ];
  const inferredModes = modeRules.map((rule) => {
    const evidence = source.find((item) => rule.pattern.test(item));
    return evidence ? { id: rule.id, kind: rule.kind, label: compactLabel(evidence, 6), evidence, channelLabel: compactLabel(evidence, 8) } : null;
  }).filter(Boolean);
  const modes = hinted?.modes?.length ? hinted.modes : inferredModes;
  if (!modes.length) modes.push({ id: "mode-direct", kind: "direct", label: "直接作用", evidence: source[0] || motion.title, channelLabel: "作用路径" });

  const relationSentence = source.find((item) => /向|给|到/.test(item) && /传递|传输|发送|提供|输入|输出/.test(item));
  const endpoint = relationSentence?.match(/^(.{2,12}?)(?:向|给)(.{2,12}?)(?:传递|传输|发送|提供|输入|输出)/);
  const hintedSource = hinted?.entities?.find((entity) => entity.role === "source");
  const hintedTarget = hinted?.entities?.find((entity) => entity.role === "target");
  const hintedMedium = hinted?.entities?.find((entity) => ["medium", "channel", "buffer"].includes(entity.role));
  const entities = [
    { id: "actor-left", label: compactLabel(hintedSource?.label || endpoint?.[1] || concepts[0]?.label || "来源", 8), role: "source", kind: "actor", order: 1, evidence: relationSentence || source[0] || motion.title },
    { id: "channel", label: compactLabel(hintedMedium?.label || modes[0].channelLabel || "媒介", 8), role: "medium", kind: "medium", order: 2, evidence: modes[0].evidence },
    { id: "actor-right", label: compactLabel(hintedTarget?.label || endpoint?.[2] || concepts[1]?.label || "目标", 8), role: "target", kind: "actor", order: 3, evidence: relationSentence || source[1] || motion.title },
  ];
  const relations = [
    { id: "rel-input", source: "actor-left", target: "channel", type: "transfer", label: "输入", evidence: entities[0].evidence },
    { id: "rel-output", source: "channel", target: "actor-right", type: "transfer", label: "输出", evidence: entities[2].evidence },
  ];
  const defaultMode = modes.find((mode) => mode.kind === "buffer")?.id || modes[0].id;
  const phases = [
    { id: "phase-input", label: "进入", action: "emit", focusIds: ["actor-left"], at: 0 },
    { id: "phase-route", label: "经过媒介", action: "route", focusIds: ["channel"], at: 0.38 },
    { id: "phase-output", label: "到达", action: "receive", focusIds: ["actor-right"], at: 1 },
  ];
  return { nodes: entities, entities, relations, edges: relations, modes, defaultMode, phases };
}

function sanitizeSemanticHint(hint) {
  if (!hint || typeof hint !== "object") return null;
  const allowedTypes = new Set(Object.keys(visualTypeLabels));
  if (!allowedTypes.has(hint.visualType) || !Array.isArray(hint.entities) || hint.entities.length < 2) return null;
  const entities = hint.entities.slice(0, 6).map((entity, index) => ({
    id: String(entity.id || `ai-node-${index + 1}`).replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 36),
    label: compactLabel(entity.label || entity.name || `概念 ${index + 1}`, 8),
    detail: String(entity.detail || "").slice(0, 96),
    evidence: String(entity.evidence || entity.label || "").slice(0, 180),
    kind: String(entity.kind || "concept").slice(0, 24),
    role: String(entity.role || "concept").slice(0, 24),
    order: index + 1,
  }));
  const lookup = new Map();
  entities.forEach((entity) => { lookup.set(entity.id, entity.id); lookup.set(canonical(entity.label), entity.id); });
  const relations = Array.isArray(hint.relations) ? hint.relations.slice(0, 8).map((relation, index) => {
    const source = lookup.get(String(relation.source || "")) || lookup.get(canonical(relation.source));
    const target = lookup.get(String(relation.target || "")) || lookup.get(canonical(relation.target));
    if (!source || !target || source === target) return null;
    return { id: `ai-rel-${index + 1}`, source, target, type: String(relation.type || "related").slice(0, 24), label: compactLabel(relation.label || relation.type || "关联", 6), evidence: String(relation.evidence || "").slice(0, 180) };
  }).filter(Boolean) : [];
  const allowedModeKinds = new Set(["direct", "buffer", "shared", "remote"]);
  const modes = Array.isArray(hint.modes) ? hint.modes.slice(0, 4).map((mode, index) => ({
    id: `ai-mode-${index + 1}`,
    label: compactLabel(mode.label || `方式 ${index + 1}`, 6),
    kind: allowedModeKinds.has(mode.kind) ? mode.kind : "direct",
    evidence: String(mode.evidence || mode.label || "").slice(0, 180),
    channelLabel: compactLabel(mode.channelLabel || mode.label || "媒介", 8),
  })) : [];
  const groups = Array.isArray(hint.groups) ? hint.groups.slice(0, 2).map((group, index) => ({ id: `ai-group-${index + 1}`, label: compactLabel(group.label || `对象 ${index + 1}`, 8), nodeIds: (group.entityIds || group.nodeIds || []).map((id) => lookup.get(String(id)) || lookup.get(canonical(id))).filter(Boolean) })) : [];
  const values = Array.isArray(hint.values) ? hint.values.map(Number).filter(Number.isFinite).slice(0, 8) : [];
  return {
    visualType: hint.visualType,
    entities,
    relations,
    modes,
    groups,
    values,
    teachingQuestion: compactLabel(hint.teachingQuestion || "观察什么发生变化", 24),
    visualIntent: String(hint.visualIntent || "").slice(0, 80),
    storyboard: Array.isArray(hint.storyboard) ? hint.storyboard.slice(0, 6).map((item) => compactLabel(item, 10)) : [],
  };
}

function planFromHint(motion, hinted) {
  if (hinted.visualType === "mechanism") return mechanismPlan(motion, uniqueConcepts(motion.items), hinted);
  const relations = hinted.relations;
  if (["cause", "flow", "cycle", "state", "allocation"].includes(hinted.visualType) && !relations.length) return null;
  const phases = hinted.storyboard.length
    ? hinted.storyboard.map((label, index) => ({ id: `phase-${index + 1}`, label, action: "advance", focusIds: hinted.entities[index] ? [hinted.entities[index].id] : [], at: hinted.storyboard.length <= 1 ? 0 : index / (hinted.storyboard.length - 1) }))
    : sequenceFor(hinted.entities, relations, "advance");
  return { nodes: hinted.entities, entities: hinted.entities, relations, edges: relations, groups: hinted.groups, modes: hinted.modes, values: hinted.values, phases };
}

function localPlan(motion, requestedType) {
  const concepts = uniqueConcepts(motion.items || [], 6);
  const attempts = {
    mechanism: () => mechanismPlan(motion, concepts),
    cause: () => causePlan(motion),
    hierarchy: () => hierarchyPlan(motion, concepts),
    comparison: () => comparisonPlan(motion, concepts),
    flow: () => orderedPlan(motion, concepts, "flow"),
    state: () => orderedPlan(motion, concepts, "state"),
    cycle: () => orderedPlan(motion, concepts, "cycle"),
    allocation: () => allocationPlan(motion),
    trajectory: () => trajectoryPlan(motion),
  };
  const semantic = attempts[requestedType]?.();
  if (semantic) return { visualType: requestedType, semantic, confidence: "evidence-backed" };
  const hierarchy = requestedType !== "hierarchy" ? hierarchyPlan(motion, concepts) : null;
  if (hierarchy) return { visualType: "hierarchy", semantic: hierarchy, confidence: "structure-backed" };
  return { visualType: "reveal", semantic: revealPlan(motion, concepts), confidence: "structure-backed" };
}

export function buildScene(motion) {
  const hinted = sanitizeSemanticHint(motion.semantic);
  if (motion.requireSemantic && !hinted) {
    throw new Error("模型场景缺少可执行的对象与关系，禁止改用本地模板补齐");
  }
  const requestedType = hinted?.visualType || inferVisualType(motion);
  const hintedPlan = hinted ? planFromHint(motion, hinted) : null;
  if (motion.requireSemantic && !hintedPlan) {
    throw new Error("模型场景没有通过视觉语义校验，禁止改用本地模板补齐");
  }
  const plan = hintedPlan
    ? { visualType: requestedType, semantic: hintedPlan, confidence: "model-and-evidence" }
    : localPlan(motion, requestedType);
  const visualType = plan.visualType;
  const semantic = plan.semantic;
  const totalDurationMs = Math.max(3600, (semantic.phases?.length || 4) * 1100);
  const teachingQuestion = hinted?.teachingQuestion || `“${compactLabel(motion.title, 12)}”中什么在变化？`;
  return {
    version: 3,
    renderer: "svg",
    visualType,
    visualTypeLabel: visualTypeLabels[visualType],
    visualReason: hinted?.visualIntent || visualReasons[visualType],
    teachingQuestion,
    confidence: plan.confidence,
    visualContract: { maxObjects: 6, maxLabelCharacters: 8, paragraphsInCanvas: false, oneQuestionPerScene: true },
    layout: visualType,
    width: 1120,
    height: 600,
    title: motion.title,
    sourceSlides: motion.slideNumbers || [motion.slideNumber],
    totalDurationMs,
    ...semantic,
    sequence: (semantic.phases || []).map((phase, index) => ({
      ...phase,
      delayMs: Math.round((phase.at ?? (index / Math.max(1, semantic.phases.length - 1))) * totalDurationMs),
      durationMs: 720,
    })),
  };
}

export { compactLabel, visualTypeLabels };
