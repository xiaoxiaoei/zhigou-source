export function requireDestination(units,id){
  if(!id)return null;
  const unit=units.find(u=>u.id===id&&!u.isDemo);
  if(!unit)throw Error('目标教学单元已不存在，请重新选择归属，不会自动创建新单元。');
  return unit;
}
export function saveMaterialToUnit(unit,{title,pages,filename='',sourceFormat='text'},idFactory=()=>crypto.randomUUID()){
  if(!unit?.id)throw Error('请先选择已有教学单元。');
  const selected=(pages||[]).map(p=>({number:Number(p.number),title:p.title||`第 ${p.number} 页`,text:String(p.text||'')}));
  if(selected.reduce((n,p)=>n+p.text.trim().length,0)<8)throw Error('材料正文过少，请先识字或补充文字。');
  if(selected.reduce((n,p)=>n+p.text.length,0)>250000)throw Error('所选正文超过25万字，请缩小范围。');
  const material={id:'material-'+idFactory(),role:'reference',kind:'text',title:String(title||filename||'补充材料'),filename,sourceFormat,pages:selected,slideCount:selected.length,createdAt:new Date().toISOString(),revisions:[]};
  unit.materials=[...(unit.materials||[]),material];return material;
}
