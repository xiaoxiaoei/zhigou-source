function cleanTitle(line = "") {
  return String(line)
    .replace(/^\s{0,3}#{1,6}\s*/, "")
    .replace(/^\s*(?:[-*•·]|\d+[.、)]|[一二三四五六七八九十]+[、.)])\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseCourseOutline(text = "", limit = 60) {
  const seen = new Set();
  const rows = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const title = cleanTitle(raw);
    if (!title || /^(目录|课程目录|教学目录|contents?)$/i.test(title) || title.length > 100) continue;
    const key = title.toLocaleLowerCase("zh-CN");
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ id: `outline-${rows.length + 1}`, title, raw: raw.trim() });
    if (rows.length >= limit) break;
  }
  return rows;
}

export function createCourseUnitSkeletons({ course, titles = [], duration = "90 分钟", existingUnits = [], idFactory = () => crypto.randomUUID(), now = new Date().toISOString() } = {}) {
  if (!course?.name) return { units: [], skipped: titles.length };
  const existing = new Set((existingUnits || []).filter(unit => unit.course === course.name).map(unit => String(unit.title || "").trim().toLocaleLowerCase("zh-CN")));
  const units = [];
  let skipped = 0;
  for (const value of titles) {
    const title = String(typeof value==='object'?value.title:value || "").trim();
    const key = title.toLocaleLowerCase("zh-CN");
    if (!title || existing.has(key)) { skipped += 1; continue; }
    existing.add(key);
    units.push({
      id: `unit-${idFactory()}`,
      isDemo: false,
      title,
      course: course.name,
      chapter: title,
      outlineLevel: typeof value==='object'?value.level||'topic':'topic',
      parentChapter: typeof value==='object'?value.parentTitle||'':'',
      duration,
      status: "待分析",
      completion: 0,
      updated: "刚刚",
      source: { kind: "course-outline", title: `${course.name}课程目录`, outlineItem: title },
      overview: `“${title}”的教学目标、知识逻辑与课堂活动尚待分析。`,
      objectives: [], keyPoints: [], knowledgeRelations: [],
      lesson: { flow: [], questions: [], afterClass: [] },
      resources: [], animations: [], improvementActions: [],
      versionHistory: [],
      batchCreatedAt: now,
    });
  }
  return { units, skipped };
}
