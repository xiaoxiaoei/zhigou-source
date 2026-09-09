export function parsePageRange(value,total){
  const text=String(value||'').trim().replace(/[，、；;]/g,',').replace(/[–—~～至]/g,'-').replace(/\s*-\s*/g,'-');
  if(!text)return [];
  const selected=new Set();
  for(const part of text.split(/[,\s]+/).filter(Boolean)){
    const match=part.match(/^(\d+)(?:-(\d+))?$/);
    if(!match)throw Error('页码格式不正确，例如：3, 8, 12-15');
    const first=Number(match[1]),last=Number(match[2]||first);
    if(first<1||last>total||first>last)throw Error(`页码须在 1-${total} 内，起始页不能大于结束页`);
    for(let n=first;n<=last;n++)selected.add(n);
  }
  return [...selected].sort((a,b)=>a-b);
}
export function formatPageRange(numbers){
  const pages=[...new Set(numbers)].sort((a,b)=>a-b),ranges=[];
  for(let i=0;i<pages.length;i++){const start=pages[i];while(pages[i+1]===pages[i]+1)i++;ranges.push(start===pages[i]?String(start):`${start}-${pages[i]}`);}
  return ranges.join(', ');
}
