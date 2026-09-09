import {fingerprint,localTarget} from './local-rebuild.js';

export function archivePendingResult(unit) {
  const pending=unit.pendingLocalResult;
  if(!pending)return false;
  unit.motionDraftArchive ||= [];
  if(!unit.motionDraftArchive.some(p=>p.jobId===pending.jobId))unit.motionDraftArchive.push({...pending,archivedAt:new Date().toISOString()});
  unit.pendingLocalResult=null;
  return true;
}

export function resultConflict(unit,pending,source) {
  if(pending.sourceBaseline&&pending.sourceBaseline!==fingerprint(source))return '参考材料已变化，此结果仅供对照，请重新生成。';
  const current=pending.kind==='plan'?unit.keyPoints?.[pending.index]:pending.kind==='render'?unit.keyPoints?.find(p=>p.id===pending.value.knowledgePointId):localTarget(unit,pending.kind,pending.index);
  if(!current||fingerprint(current)!==pending.baseline)return '原条目已修改或删除，此结果仅供对照。';
  if(pending.kind==='render'){
    const plan=unit.motionPlans?.[pending.planIndex];
    if(!plan||fingerprint(plan.blueprint)!==pending.planBaseline)return '讲解方案已变化，此草稿仅供对照，请按新方案绘制。';
  }
  return '';
}
