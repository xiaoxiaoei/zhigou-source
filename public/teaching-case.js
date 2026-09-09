import {buildTeachingAlignment} from './teaching-alignment.js';
import {assessMotionQuality} from './motion-quality.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function fingerprint(content){const text=JSON.stringify(content);let a=2166136261,b=5381;for(let i=0;i<text.length;i++){a=Math.imul(a^text.charCodeAt(i),16777619);b=Math.imul(b,33)^text.charCodeAt(i);}return `${text.length}:${a>>>0}:${b>>>0}`;}
export function reviewTargets(unit){
  return [
    ...(unit.keyPoints||[]).map((p,i)=>({id:`knowledge:${p.id||i}`,kind:'知识原理',title:p.title,content:{logic:p.logic||p.coreLogic||p.explanation,evidence:p.evidence,source:unit.source,materials:unit.materials},detail:p.logic||p.coreLogic||p.explanation||'尚无原理说明'})),
    ...(unit.animations||[]).map((m,i)=>{const v=m.versions?.find(v=>v.versionNumber===m.currentVersion)||m.versions?.at(-1)||m;return{id:`motion:${m.id||i}`,kind:'动效',title:m.title,content:{version:v.versionId||v.versionNumber,scene:v.scene,narration:v.narration,explanation:v.explanation,source:unit.source,knowledge:unit.keyPoints},detail:v.narration||v.explanation||v.scene?.designRationale||'请打开动效逐步核对',automatic:assessMotionQuality(v)};})
  ].map(t=>({...t,fingerprint:fingerprint({content:t.content,objectives:unit.objectives,context:unit.teachingContext})}));
}
export function currentReview(unit,target){
  const latest=(unit.caseReviews||[]).find(r=>r.targetId===target.id);
  if(!latest)return {status:'pending',label:'待教师审核'};
  if(latest.fingerprint!==target.fingerprint)return {status:'stale',label:'内容已变更，需重新审核',record:latest};
  return {status:latest.status,label:latest.status==='approved'?'教师已审核':'需修改',record:latest};
}
export function addCaseReview(unit,{targetId,fingerprint,status,reviewer,note,checks}){
  const target=reviewTargets(unit).find(t=>t.id===targetId);
  if(!target||target.fingerprint!==fingerprint)throw Error('内容已发生变化，请重新打开后审核');
  if(!['approved','needs-revision'].includes(status)||!reviewer?.trim()||!note?.trim())throw Error('请填写审核人及具体审核意见');
  if(status==='approved'&&(!checks?.facts||!checks?.logic||!checks?.clarity))throw Error('请逐项确认事实、原理步骤和可理解性');
  if(status==='approved'&&target.automatic&&!target.automatic.ready)throw Error('动效仍有自动检查阻塞项，请先在动效实验室修订');
  const record={targetId,fingerprint,status,reviewer:reviewer.trim(),note:note.trim(),checks:{...checks},at:new Date().toISOString()};
  unit.caseReviews=[record,...(unit.caseReviews||[])];return record;
}
export function addCaseRun(unit,input){
  if(!input.date||!input.observation?.trim())throw Error('请填写日期和具体观察记录');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(input.date)||Number.isNaN(Date.parse(input.date+'T00:00:00Z'))||new Date(input.date+'T00:00:00Z').toISOString().slice(0,10)!==input.date)throw Error('请填写有效日期');
  if(!['trial','classroom'].includes(input.kind))throw Error('请选择试运行或真实课堂');
  const record={id:crypto.randomUUID(),at:new Date().toISOString(),date:input.date,kind:input.kind,observation:input.observation.trim(),evidence:input.evidence?.trim()||'',adopted:input.adopted?.trim()||'',model:input.model?.trim()||''};
  for(const k of ['preparation','waiting','revision']){const v=input[k];if(v===''||v==null)record[k]=null;else{if(!Number.isFinite(Number(v))||Number(v)<0)throw Error('耗时必须为非负分钟数，未知请留空');record[k]=Number(v);}}
  record.total=[record.preparation,record.waiting,record.revision].every(v=>v!==null)?record.preparation+record.waiting+record.revision:null;
  unit.caseRuns=[record,...(unit.caseRuns||[])];return record;
}
export function updateCaseRun(unit,id,input,expected){
  const index=(unit.caseRuns||[]).findIndex(r=>r.id===id),old=unit.caseRuns?.[index];
  if(!old||old.withdrawnAt)throw Error('记录不存在或已撤回');
  if(expected!==JSON.stringify(old))throw Error('记录已被修改，请重新打开后更正');
  const holder={};const next=addCaseRun(holder,input);
  const {history,...snapshot}=old;
  const record={...next,id:old.id,at:old.at,updatedAt:new Date().toISOString(),history:[snapshot,...(old.history||[])]};
  unit.caseRuns[index]=record;return record;
}
export function withdrawCaseRun(unit,id){
  const record=(unit.caseRuns||[]).find(r=>r.id===id);
  if(!record)throw Error('记录不存在');
  record.withdrawnAt=new Date().toISOString();return record;
}
export function restoreCaseRun(unit,id){const record=(unit.caseRuns||[]).find(r=>r.id===id);if(!record)throw Error('记录不存在');delete record.withdrawnAt;record.restoredAt=new Date().toISOString();return record;}
export function caseReport(unit){
  const alignment=buildTeachingAlignment(unit),targets=reviewTargets(unit).map(t=>({...t,review:currentReview(unit,t)}));
  const gaps=[];
  if(unit.isDemo)gaps.push('体验示例不能作为真实应用成效');
  if(!unit.teachingContext?.audience?.trim())gaps.push('未说明学生基础');
  if(!alignment.total)gaps.push('缺少学习目标');
  alignment.rows.forEach(r=>{if(!r.confirmed||r.gaps.length)gaps.push(`目标 ${r.index+1}：${[...r.gaps,...(!r.confirmed?['关联待教师确认']:[])].join('、')}`);});
  targets.forEach(t=>{if(t.review.status!=='approved')gaps.push(`${t.kind} ${t.title||''}：${t.review.label}`);if(t.automatic&&!t.automatic.ready)gaps.push(`${t.title}：${t.automatic.blockers.map(b=>b.label).join('、')}`);});
  const runs=(unit.caseRuns||[]).filter(r=>!r.withdrawnAt);
  if(!runs.some(r=>r.kind==='classroom'))gaps.push('尚无真实课堂使用记录，不得表述为已验证学习成效');
  return {alignment,targets,gaps,runs};
}
export function buildCaseHtml(unit){
  const r=caseReport(unit),list=items=>`<ul>${items.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`;
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${esc(unit.title)} 应用案例</title><style>body{max-width:900px;margin:40px auto;padding:0 24px;font:17px/1.8 system-ui;color:#192c23}h1{font-size:28px}h2{font-size:22px}article{border-bottom:1px solid #ddd;padding:12px 0}p{white-space:pre-wrap}@media print{article{break-inside:avoid}}</style><h1>${esc(unit.title)} 应用案例</h1><p>课程：${esc(unit.course)} · 导出时间：${esc(new Date().toLocaleString('zh-CN'))}</p><p>${unit.isDemo?'体验示例，非真实应用证据。':'本记录区分自动检查、教师审核和自行填写的课堂观察，不自动推断教学成效。'}</p><h2>教学场景</h2><p>学生基础：${esc(unit.teachingContext?.audience||'未填写')}\n课时：${esc(unit.duration)}\n应用场景：${esc(unit.teachingContext?.scenario||'未填写')}\n材料：${esc(unit.source?.filename||unit.source?.title||unit.source?.mode||'未记录')}\n所选原页码：${esc((unit.source?.selectedPageNumbers||[]).join('、')||'未记录选页范围')}</p><h2>学习目标</h2>${list(unit.objectives||[])}<h2>目标关联</h2>${list(r.alignment.rows.map(x=>`${x.objective}：${x.confirmed?'教师确认':'系统建议'}；${x.gaps.join('、')||'结构完整（不等于教学有效）'}`))}<h2>待处理事项</h2>${list(r.gaps)}<h2>当前内容审核</h2>${r.targets.map(t=>`<article><h3>${esc(t.kind)} ${esc(t.title)}</h3><p>${esc(t.detail)}</p><p>${esc(t.review.label)}${t.review.record?` · ${esc(t.review.record.reviewer)} · ${esc(t.review.record.at)}<br>${esc(t.review.record.note)}`:''}</p></article>`).join('')}<h2>使用记录</h2>${r.runs.length?r.runs.map(x=>`<article><h3>${esc(x.date)} ${x.kind==='classroom'?'真实课堂（教师填写）':'试运行，非课堂成效'}</h3><p>准备 ${esc(x.preparation??'未记录')} 分钟；等待及重试 ${esc(x.waiting??'未记录')} 分钟；人工修订 ${esc(x.revision??'未记录')} 分钟；合计 ${esc(x.total??'无法计算')} 分钟。\n模型：${esc(x.model||'未记录')}\n采用内容：${esc(x.adopted||'未填写')}\n观察：${esc(x.observation)}\n证据位置：${esc(x.evidence||'未提供')}</p></article>`).join(''):'<p>尚无记录。</p>'}<h2>历史审核意见</h2>${list((unit.caseReviews||[]).map(x=>`${x.at} ${x.reviewer} ${x.targetId} ${x.status==='approved'?'审核通过':'需修改'}：${x.note}（历史意见不代表当前内容已通过）`))}<p>本地工作台使用云端模型时，所选文本会发送至配置的服务；缩略图预览不调用模型。软件测试结果不等同于教学效果证据。</p></html>`;
}
