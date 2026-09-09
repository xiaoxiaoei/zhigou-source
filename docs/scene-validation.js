import {applySceneProgress} from './scene-runtime.js';

function visible(el, container) {
  if (el.closest('defs,clipPath,mask,marker')) return false;
  for (let p=el; p && p!==container; p=p.parentElement) {
    const s=getComputedStyle(p);
    if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0) return false;
  }
  return true;
}
function endpoints(el) {
  try {
    if (!el.getTotalLength || !el.getScreenCTM()) return [];
    return [el.getPointAtLength(0), el.getPointAtLength(el.getTotalLength())]
      .map(p => new DOMPoint(p.x,p.y).matrixTransform(el.getScreenCTM()));
  } catch { return []; }
}
function inside(p,r,margin=3) {return p.x>r.left+margin&&p.x<r.right-margin&&p.y>r.top+margin&&p.y<r.bottom-margin;}

export function inspectSceneFrames(container,scene){
  const svg=container?.querySelector('svg');
  if(!svg)return {passed:false,detail:'没有可显示的SVG',samples:[],warnings:[]};
  const issues=new Map();
  const times=[...new Set([0,.25,.5,.75,.95,.999,...(scene?.phases||[]).map(p=>Math.min(.999,Math.max(0,Number(p.at)||0)))])].sort((a,b)=>a-b);
  const samples=times.map(progress=>{
    applySceneProgress(container,scene,progress);
    const frame=svg.getBoundingClientRect();
    const all=[...svg.querySelectorAll('path,rect,circle,ellipse,line,polyline,polygon,text,use')].filter(el=>visible(el,container));
    const shown=all.filter(el=>{const r=el.getBoundingClientRect();return r.width+r.height>0&&r.right>frame.left&&r.left<frame.right&&r.bottom>frame.top&&r.top<frame.bottom;});
    function warn(code,el,detail) {
      const object=el.id||el.tagName+'#'+(all.indexOf(el)+1),key=code+':'+object;
      if(!issues.has(key))issues.set(key,{code,object,detail,at:[]});
      issues.get(key).at.push(Math.round(progress*100));
    }
    const boxes=shown.filter(el=>/^(rect|circle|ellipse|polygon)$/i.test(el.tagName)&&getComputedStyle(el).fill!=='none').filter(el=>{const r=el.getBoundingClientRect();return r.width<frame.width*.8&&r.height<frame.height*.8;});
    for(const el of shown){
      const r=el.getBoundingClientRect();
      if(el.tagName.toLowerCase()==='text'&&(r.left<frame.left-2||r.right>frame.right+2||r.top<frame.top-2||r.bottom>frame.bottom+2))warn('overflow',el,'文字超出画布边界');
      if(!el.matches('[data-connector],[marker-end]'))continue;
      try {
        const matrix=el.getScreenCTM(),length=el.getTotalLength();
        if(matrix)for(let i=1;i<32;i++){
          const local=el.getPointAtLength(length*i/32),p=new DOMPoint(local.x,local.y).matrixTransform(matrix);
          if(shown.some(text=>text.tagName.toLowerCase()==='text'&&inside(p,text.getBoundingClientRect(),2))){warn('line-text',el,'连线经过可见文字区域，请调整路径或标签位置');break;}
        }
      } catch {}
      for(const p of endpoints(el))for(const node of boxes){
        try{
          const matrix=node.getScreenCTM();if(!matrix)continue;
          const local=new DOMPoint(p.x,p.y).matrixTransform(matrix.inverse());
          if(inside(p,node.getBoundingClientRect(),4)&&node.isPointInFill?.(local))warn('connector',el,'连线端点进入对象 '+(node.id||node.tagName)+' 内部，请核对是否为预期指向');
        }catch{}
      }
    }
    const texts=shown.filter(el=>el.tagName.toLowerCase()==='text');
    for(let i=0;i<texts.length;i++)for(let j=i+1;j<texts.length;j++){
      const a=texts[i].getBoundingClientRect(),b=texts[j].getBoundingClientRect();
      const overlap=Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
      if(overlap>Math.min(a.width*a.height,b.width*b.height)*.2)warn('text-overlap',texts[i],'文字与 '+(texts[j].id||'另一标签')+' 可能重叠');
    }
    return {progress,visible:shown.length};
  });
  applySceneProgress(container,scene,0);
  return {passed:samples.every(x=>x.visible>=2),samples,warnings:[...issues.values()],detail:samples.map(x=>Math.round(x.progress*100)+'%：'+x.visible+'个可见图元').join('；')};
}
