function value(input = "") { return String(input || "").trim(); }

const placeholderPattern = /^(?:示例代码|待补充|暂无|todo|tbd|code)$/i;
const observationPattern = /观察|关注|比较|预测|记录|解释|判断|变量|状态|输出|顺序|变化|结果|断点|追踪|调用|返回/;
const contextPattern = /初始|输入|前置|假设|开始时|运行前|给定|环境|参数|数据/;

export function assessCodeResource(resource = {}, index = 0) {
  const details = resource.details || {}, language = value(details.language), code = value(details.code), sampleInput = value(details.sampleInput), walkthrough = value(details.walkthrough);
  const codeLines = code ? code.split(/\r?\n/).length : 0;
  const traces = Array.isArray(details.traceSteps) ? details.traceSteps.map(item => ({ line: Number(item?.line || 0), state: value(item?.state), explanation: value(item?.explanation) })) : [];
  const languageReady = language.length >= 2;
  const codeReady = code.length >= 8 && !placeholderPattern.test(code);
  const contextReady = sampleInput.length >= 3 || contextPattern.test(walkthrough);
  const walkthroughReady = walkthrough.length >= 16 && observationPattern.test(walkthrough);
  const validTraces = traces.filter(item => item.line >= 1 && item.line <= codeLines && item.state.length >= 2 && item.explanation.length >= 4);
  const traceValid = traces.length === 0 || validTraces.length === traces.length;
  const traceReady = validTraces.length >= 2;
  const issues = [];
  if (!languageReady) issues.push("没有说明语言或运行环境");
  if (!codeReady) issues.push("演示代码为空或仍是占位内容");
  if (!contextReady) issues.push("缺少输入、初始状态或运行前提");
  if (!walkthroughReady) issues.push("没有说明学生需要观察的状态变化");
  if (!traceValid) issues.push(`${traces.length-validTraces.length} 个追踪帧的行号、状态或解释无效`);
  return { index, title: value(resource.title) || `代码演示 ${index + 1}`, language, code, sampleInput, walkthrough, codeLines, traces, validTraces, languageReady, codeReady, contextReady, walkthroughReady, traceValid, traceReady, ready: languageReady && codeReady && contextReady && walkthroughReady && traceValid, issues };
}

export function assessCodeQuality(unit = {}) {
  const resources = Array.isArray(unit.resources) ? unit.resources : [];
  const rows = resources.map((resource, index) => ({ resource, index })).filter(item => item.resource?.type === "code").map((item, codeIndex) => ({ ...assessCodeResource(item.resource, codeIndex), resourceIndex: item.index }));
  return { rows, total: rows.length, ready: rows.filter(row => row.ready).length, traceReady: rows.filter(row => row.traceReady).length };
}
