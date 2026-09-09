// These checks are conservative scheduling heuristics, not pedagogical scoring.
export function isQuickQuestion(phase) {
  const text=[phase.phase,phase.teacherAction,phase.studentAction].join(' ');
  return /选择题|判断题|单选|一道题|一题/.test(text) && !/小组|辩论|实验|编程|多轮|系列|多道|错因分析|方案比较/.test(text);
}
export function densityInstruction(minutes, deliverables='all') {
  const count=Math.max(2,Math.min(12,Math.ceil(minutes/12)));
  return `课堂充实度要求：${minutes}分钟不是把少量内容按比例拉长。一道普通选择/判断题含反馈一般1—4分钟；超过4分钟必须有真实的多轮推理、讨论或迁移任务，不能只写“讨论”。${deliverables==='motion'?'动效方案之外不强制增加题量。':`提供至少${count}个紧扣知识点、不同认知层次的完整诊断问题（包含答案与错因），不要换措辞重复。`}每个超过10分钟的环节写清分步活动、时间分配、具体问题/例子、学生提交物及反馈；计算/编程/实验的时间由实际任务量支撑。每个核心机制至少有具体例子、易错反例或边界比较；不要为了丰富引入范围外新知识。题干与讲解必须完整，不用省略号代替内容。`;
}
export function lessonDensityIssues(plan, minutes, deliverables='all') {
  const issues=[];
  for(const p of plan.flow||[]){
    if(isQuickQuestion(p)&&Number(p.minutes)>4)issues.push(`“${p.phase}”单题活动安排${p.minutes}分钟，缺乏支撑；缩至1—4分钟或提供真实多步骤任务。`);
    if(Number(p.minutes)>10 && String(p.teacherAction||'').length+String(p.studentAction||'').length<90)issues.push(`“${p.phase}”超过10分钟但活动描述过少，需分步任务和产出。`);
  }
  const questions=plan.assessment?.length?plan.assessment:plan.questions||[];
  const minimum=Math.max(2,Math.min(12,Math.ceil(minutes/12)));
  if(deliverables!=='motion'&&questions.length<minimum)issues.push(`当前仅${questions.length}题，需至少${minimum}个不同认知层次的完整问题。`);
  return issues;
}
