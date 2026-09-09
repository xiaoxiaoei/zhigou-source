function clean(value = "") {
  return String(value).replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function buildSourcePageIndex(slides = [], keyPoints = [], options = {}) {
  const maxPages = Math.max(1, Number(options.maxPages || 40));
  const maxChars = Math.max(300, Number(options.maxChars || 2400));
  const referenced = new Set((keyPoints || []).flatMap(point => [
    ...(point?.slideNumbers || []),
    ...(point?.evidence || []).map(item => item?.slideNumber),
  ]).map(Number).filter(Number.isFinite));
  return (slides || []).filter(slide => referenced.has(Number(slide?.number))).slice(0, maxPages).map(slide => ({
    number: Number(slide.number),
    title: clean(slide.title || `第 ${slide.number} 页`).slice(0, 120),
    text: clean(slide.text || [slide.title, ...(slide.paragraphs || []).map(item => item?.text), slide.notes].filter(Boolean).join("\n")).slice(0, maxChars),
  })).filter(page => page.number && page.text);
}

export function locateQuoteInContext(text = "", quote = "") {
  const source = String(text), needle = String(quote).trim(), index = needle ? source.indexOf(needle) : -1;
  if (index < 0) return { before: source, match: "", after: "", found: false };
  return { before: source.slice(0, index), match: source.slice(index, index + needle.length), after: source.slice(index + needle.length), found: true };
}
