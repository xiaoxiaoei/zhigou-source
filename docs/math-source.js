export function normalizeMathSource(source=''){
  // Models sometimes Markdown-escape TeX subscripts. Only repair inside math.
  return String(source).replace(/\\_\s*\{/g,'_{').replace(/\\\^\s*\{/g,'^{');
}
