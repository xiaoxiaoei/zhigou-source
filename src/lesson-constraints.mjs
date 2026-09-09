import {isQuickQuestion} from './lesson-density.mjs';
export function normalizeTask(input = {}, request = '', mode = '') {
  const explicit = Number.parseInt(input.duration, 10);
  const mentioned = String(request).match(/(\d{1,3})\s*分钟/);
  const duration = Math.min(360, Math.max(5, mentioned ? Number(mentioned[1]) : explicit || 45));
  return { duration, mode, audience: String(input.audience || '').slice(0, 1000),
    deliverables: ['all', 'lesson', 'questions', 'motion'].includes(input.deliverables) ? input.deliverables : 'all',
    maxPoints: mode === 'concept' ? 3 : duration <= 20 ? 4 : 10,
    maxMotions: input.deliverables === 'lesson' || input.deliverables === 'questions' ? 0 : mode === 'concept' || duration <= 20 ? 1 : 3 };
}
export function taskInstruction(task) {
  return `本次备课约束：${JSON.stringify(task)}。${task.deliverables==="questions"?"只需知识分析、短课时流程与诊断题，resources必须为空数组，不要生成代码或实验。":task.deliverables==="motion"?"只需必要知识分析和动效方案，resources为空数组。":""}只覆盖输入范围，知识点最多${task.maxPoints}个，不凑数量；总课时严格为${task.duration}分钟。资源按教师选择生成，不强制凑齐代码、实验、案例。用户只提供大纲或知识点时允许合理扩展，但补充情境必须标注“AI补充示例”，不能伪装成材料原文。`;
}
export function fitLessonDuration(plan, minutes) {
  const flow = plan.flow || [];
  if (!flow.length) return plan;
  const total = flow.reduce((n, p) => n + Math.max(1, Number(p.minutes) || 1), 0);
  const allocation = flow.map(p => Math.max(1, Number(p.minutes) || 1) / total * minutes);
  const result = allocation.map(Math.floor);
  let remaining = minutes - result.reduce((a,b) => a+b, 0);
  allocation.map((v,i)=>({i,f:v-result[i]})).sort((a,b)=>b.f-a.f).forEach(({i})=>{if(remaining>0){result[i]++;remaining--;}});
  let spare=0;
  flow.forEach((p,i)=>{if(isQuickQuestion(p)&&result[i]>4){spare+=result[i]-4;result[i]=4;}});
  // Do not silently inflate the remaining lesson to fill time: retain a visible gap.
  const unallocatedMinutes=spare;
  return { ...plan, duration: minutes, timingAdjusted: total !== minutes || spare>0, unallocatedMinutes,
    flow: flow.map((p,i)=>({...p, minutes:result[i]})).filter(p=>p.minutes>0) };
}
