export function safeSvg(value){
  const svg=String(value||'').trim();
  if(!/^<svg\b[\s\S]*<\/svg>$/i.test(svg)||/<\s*(?:script|foreignObject|iframe|object|embed|audio|video)\b|\son\w+\s*=|javascript\s*:|<!DOCTYPE|<!ENTITY|@import/i.test(svg))return '';
  if([...svg.matchAll(/(?:href|src)\s*=\s*["']([^"']*)["']/gi)].some(x=>!x[1].startsWith('#')))return '';
  if([...svg.matchAll(/url\(\s*["']?([^\s)'";]+)/gi)].some(x=>!x[1].startsWith('#')))return '';
  return svg;
}
