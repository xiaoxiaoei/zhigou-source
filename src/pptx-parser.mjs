import JSZip from "jszip";
import path from "node:path";

const xmlEntities = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeXml(value = "") {
  return value
    .replace(/&#(x?[0-9a-f]+);/gi, (_match, code) => {
      const radix = code.toLowerCase().startsWith("x") ? 16 : 10;
      return String.fromCodePoint(Number.parseInt(code.replace(/^x/i, ""), radix));
    })
    .replace(/&(amp|lt|gt|quot|apos);/g, (_match, key) => xmlEntities[key]);
}

function cleanText(value = "") {
  return decodeXml(value)
    .replace(/\u00a0/g, " ")
    .replace(/[\t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

function collectText(xml = "") {
  return cleanText(
    [...xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)]
      .map((match) => match[1])
      .join(""),
  );
}

function collectParagraphs(xml = "") {
  const paragraphs = [];
  for (const match of xml.matchAll(/<a:p(?:\s[^>]*)?>([\s\S]*?)<\/a:p>/g)) {
    const block = match[1];
    const text = collectText(block);
    if (!text) continue;
    const levelMatch = block.match(/<a:pPr[^>]*\slvl="(\d+)"/);
    const hasBullet = /<a:bu(?:Char|AutoNum|Blip)\b/.test(block);
    paragraphs.push({
      text,
      level: levelMatch ? Number(levelMatch[1]) : 0,
      bullet: hasBullet,
    });
  }
  return paragraphs;
}

function extractShapes(slideXml = "") {
  const shapes = [];
  for (const match of slideXml.matchAll(/<p:sp(?:\s[^>]*)?>([\s\S]*?)<\/p:sp>/g)) {
    const block = match[1];
    const paragraphs = collectParagraphs(block);
    if (!paragraphs.length) continue;
    const name = decodeXml(block.match(/<p:cNvPr[^>]*\sname="([^"]*)"/)?.[1] || "");
    const placeholder = block.match(/<p:ph[^>]*\stype="([^"]+)"/)?.[1] || "";
    shapes.push({ name, placeholder, paragraphs, text: paragraphs.map((p) => p.text).join("\n") });
  }
  return shapes;
}

function extractTableRows(slideXml = "") {
  const rows = [];
  for (const rowMatch of slideXml.matchAll(/<a:tr(?:\s[^>]*)?>([\s\S]*?)<\/a:tr>/g)) {
    const cells = [...rowMatch[1].matchAll(/<a:tc(?:\s[^>]*)?>([\s\S]*?)<\/a:tc>/g)]
      .map((cell) => collectText(cell[1]))
      .filter(Boolean);
    if (cells.length) rows.push(cells);
  }
  return rows;
}

function extractRelationships(xml = "") {
  const map = new Map();
  for (const match of xml.matchAll(/<Relationship\b([^>]*)\/?>(?:<\/Relationship>)?/g)) {
    const attrs = match[1];
    const id = attrs.match(/\bId="([^"]+)"/)?.[1];
    const target = attrs.match(/\bTarget="([^"]+)"/)?.[1];
    const type = attrs.match(/\bType="([^"]+)"/)?.[1] || "";
    if (id && target) map.set(id, { target, type });
  }
  return map;
}

function resolveZipPath(fromFile, target) {
  return path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), target));
}

async function getXml(zip, entryPath) {
  const entry = zip.file(entryPath);
  return entry ? entry.async("string") : "";
}

function chooseTitle(shapes, slideNumber) {
  const titleShape = shapes.find((shape) => ["title", "ctrTitle", "subTitle"].includes(shape.placeholder));
  if (titleShape?.paragraphs[0]?.text) return titleShape.paragraphs[0].text;

  const namedTitle = shapes.find((shape) => /title|标题/i.test(shape.name));
  if (namedTitle?.paragraphs[0]?.text) return namedTitle.paragraphs[0].text;

  const firstShort = shapes
    .flatMap((shape) => shape.paragraphs)
    .map((item) => item.text)
    .find((text) => text.length >= 2 && text.length <= 48);
  return firstShort || `第 ${slideNumber} 页`;
}

async function extractNotes(zip, slidePath) {
  const relPath = path.posix.join(
    path.posix.dirname(slidePath),
    "_rels",
    `${path.posix.basename(slidePath)}.rels`,
  );
  const relXml = await getXml(zip, relPath);
  const noteRel = [...extractRelationships(relXml).values()].find((rel) => rel.type.endsWith("/notesSlide"));
  if (!noteRel) return "";
  const notePath = resolveZipPath(slidePath, noteRel.target);
  const notesXml = await getXml(zip, notePath);
  return collectText(notesXml);
}

function extractCoreTitle(xml = "") {
  return cleanText(xml.match(/<dc:title(?:\s[^>]*)?>([\s\S]*?)<\/dc:title>/)?.[1] || "");
}

export async function parsePptx(buffer, filename = "presentation.pptx") {
  const zip = await JSZip.loadAsync(buffer);
  const presentationPath = "ppt/presentation.xml";
  const presentationXml = await getXml(zip, presentationPath);
  const relsXml = await getXml(zip, "ppt/_rels/presentation.xml.rels");
  const relationships = extractRelationships(relsXml);

  const slideIds = [...presentationXml.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"[^>]*\/?>(?:<\/p:sldId>)?/g)]
    .map((match) => match[1]);

  let slidePaths = slideIds
    .map((id) => relationships.get(id))
    .filter((rel) => rel?.type.endsWith("/slide"))
    .map((rel) => resolveZipPath(presentationPath, rel.target));

  if (!slidePaths.length) {
    slidePaths = Object.keys(zip.files)
      .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry))
      .sort((a, b) => Number(a.match(/slide(\d+)/)?.[1]) - Number(b.match(/slide(\d+)/)?.[1]));
  }

  const slides = [];
  for (let index = 0; index < slidePaths.length; index += 1) {
    const slidePath = slidePaths[index];
    const xml = await getXml(zip, slidePath);
    const shapes = extractShapes(xml);
    const title = chooseTitle(shapes, index + 1);
    const paragraphs = shapes
      .flatMap((shape) => shape.paragraphs)
      .filter((paragraph, paragraphIndex) => !(paragraphIndex === 0 && paragraph.text === title));
    const tables = extractTableRows(xml);
    const tableLines = tables.map((row) => row.join(" | "));
    const notes = await extractNotes(zip, slidePath);

    slides.push({
      number: index + 1,
      title,
      paragraphs,
      tableRows: tables,
      notes,
      text: [title, ...paragraphs.map((p) => p.text), ...tableLines, notes].filter(Boolean).join("\n"),
      media: {
        images: (xml.match(/<p:pic\b/g) || []).length,
        charts: (xml.match(/<c:chart\b/g) || []).length,
        tables: tables.length,
        diagrams: (xml.match(/<dgm:relIds\b/g) || []).length,
      },
    });
  }

  const coreXml = await getXml(zip, "docProps/core.xml");
  const coreTitle = extractCoreTitle(coreXml);
  const usefulCoreTitle = /^(?:(?:microsoft\s*)?powerpoint\s*)?(?:presentation|演示文稿|幻灯片)\s*\d*$/i.test(coreTitle) ? "" : coreTitle;
  const title = usefulCoreTitle || slides.find((slide) => slide.title)?.title || filename.replace(/\.pptx$/i, "");

  return {
    filename,
    title,
    slideCount: slides.length,
    slides,
  };
}
