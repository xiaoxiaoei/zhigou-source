function clean(value = "") { return String(value).replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim(); }

export function textSourceToDeck({ title = "未命名备课单元", content = "", mode = "outline" } = {}) {
  const text = clean(content);
  if (!text) throw new Error("请至少提供章节内容、知识点或备课任务描述。");
  const blocks = text.split(/\n\s*\n/).map(clean).filter(Boolean);
  const slides = (blocks.length ? blocks : [text]).map((block, index) => {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const heading = lines[0]?.replace(/^[#一二三四五六七八九十\d.、\s]+/, "").slice(0, 48) || `${title} · 内容 ${index + 1}`;
    const body = lines.slice(1).length ? lines.slice(1) : lines;
    return { number: index + 1, title: heading, paragraphs: body.map((item) => ({ text: item, level: 0, bullet: true })), tableRows: [], notes: "", text: `${heading}\n${body.join("\n")}`, media: { images: 0, charts: 0, tables: 0, diagrams: 0 } };
  });
  return { filename: `${mode}-input.txt`, title: clean(title).slice(0, 80) || "未命名备课单元", slideCount: slides.length, slides, sourceMode: mode };
}
