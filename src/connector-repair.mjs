// Only repair explicit, static, same-coordinate rectangle-to-rectangle lines.
// Ambiguous curves, animation and transformed geometry are left for preview/review.
export function repairExplicitConnectors(svg) {
  const fixes=[];
  if (/\btransform\s*=|<animateTransform|<animateMotion|@keyframes/i.test(svg)) return {svg,fixes};
  const attr=(tag,key)=>tag.match(new RegExp('\\s'+key+'\\s*=\\s*["\']([^"\']+)["\']','i'))?.[1];
  const rects=new Map();
  for(const [tag] of svg.matchAll(/<rect\b[^>]*>/gi)){
    const id=attr(tag,'id'), r={x:Number(attr(tag,'x')||0),y:Number(attr(tag,'y')||0),w:Number(attr(tag,'width')),h:Number(attr(tag,'height'))};
    if(id&&Object.values(r).every(Number.isFinite)&&r.w>0&&r.h>0)rects.set(id,r);
  }
  const corrected=svg.replace(/<line\b[^>]*\/>/gi,tag=>{
    const a=rects.get(attr(tag,'data-from')),b=rects.get(attr(tag,'data-to'));
    if(!a||!b||a===b)return tag;
    const ac={x:a.x+a.w/2,y:a.y+a.h/2},bc={x:b.x+b.w/2,y:b.y+b.h/2};
    const dx=bc.x-ac.x,dy=bc.y-ac.y,len=Math.hypot(dx,dy);if(!len)return tag;
    const scale=r=>Math.min(dx? r.w/2/Math.abs(dx):Infinity,dy?r.h/2/Math.abs(dy):Infinity);
    const start=scale(a)+14/len,end=1-scale(b)-14/len;
    if(start>=end)return tag;
    const coords={x1:ac.x+dx*start,y1:ac.y+dy*start,x2:ac.x+dx*end,y2:ac.y+dy*end};
    // Don't redirect manually chosen ports or other intended trajectories.
    const old=['x1','y1','x2','y2'].map(k=>Number(attr(tag,k)));
    if(!old.every(Number.isFinite)||Math.abs(old[0]-ac.x)>1||Math.abs(old[1]-ac.y)>1||Math.abs(old[2]-bc.x)>1||Math.abs(old[3]-bc.y)>1)return tag;
    let next=tag;
    for(const [key,value] of Object.entries(coords))next=next.replace(new RegExp('('+key+'\\s*=\\s*)["\'][^"\']+["\']','i'),'$1"'+value.toFixed(2)+'"');
    fixes.push({object:attr(tag,'id')||attr(tag,'data-from')+'→'+attr(tag,'data-to'),detail:'直线端点从对象中心移至边界外 14px'});
    return next;
  });
  return {svg:corrected,fixes};
}
