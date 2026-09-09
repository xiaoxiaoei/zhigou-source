import { fingerprint, localTarget, relatedItems, applyLocalResult } from './local-rebuild.js';
import { renderScene, applySceneProgress, standaloneSvg } from './scene-runtime.js';
import {inspectSceneFrames} from './scene-validation.js';
import {archivePendingResult,resultConflict} from './studio-drafts.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const activeKey = 'zhigou:teaching-task';
const labels = { knowledge: '知识点', question: '诊断题', resource: '教学资源' };
const describe = value => {
  const fields = { title:'名称', logic:'核心逻辑', question:'教学问题', prompt:'题目', misconception:'常见误解', answerCue:'判断依据', purpose:'教学用途', details:'资源内容', language:'语言', code:'代码', sampleInput:'输入', walkthrough:'讲解', objective:'目标', prerequisites:'准备条件', steps:'步骤', deliverables:'提交物', rubric:'评分', context:'背景', scenario:'情境', questions:'讨论问题', teachingNotes:'教师讲解', traceSteps:'追踪步骤' };
  if (Array.isArray(value)) return value.map((item,i)=>`${i+1}. ${describe(item)}`).join('\n');
  if (value && typeof value === 'object') return Object.entries(value).filter(([key])=>fields[key]).map(([key,v])=>`${fields[key]}：${describe(v)}`).join('\n\n');
  return String(value || '');
};

export function createTeachingStudio({ getUnit, getUnits, ensureEditable, commit, getMotion, onOpenMotion, showToast }) {
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = './teaching-studio.css'; document.head.append(link);
  const dialog = document.createElement('dialog'); dialog.className = 'studio-dialog'; dialog.id = 'teachingStudioDialog'; document.body.append(dialog);
  let busy = false, selectedPhase = -1;
  let activeTask=null,latestProgress=null,taskState='idle';
  const badge=document.createElement('button');badge.type='button';badge.className='studio-task-badge';badge.hidden=true;document.body.append(badge);
  function updateTask(state,payload=latestProgress){taskState=state;latestProgress=payload;badge.hidden=state==='idle';badge.textContent=state==='completed'?'动效/资源已生成 · 点击查看':state==='disconnected'?'生成仍可能继续 · 点击重新连接':state==='failed'?'生成未完成 · 点击查看原因':`${payload?.progress?.title||'动效/资源正在生成'} · 点击查看进度`;}
  function progressText(){return `${latestProgress?.model||activeTask?.model||''}\n${(latestProgress?.events||[]).slice(-25).map(e=>`${e.title||''} ${e.detail||''}`).join('\n')||latestProgress?.progress?.detail||'等待服务器更新…'}`;}
  function showTask(){
    if(taskState==='completed'){const u=getUnits().find(u=>u.id===activeTask?.unitId);if(u?.pendingLocalResult)return reviewResult(u);updateTask('idle');return showToast('结果已应用，请到该单元的资源工坊查看');}
    shell(taskState==='failed'?'生成未完成':'后台生成任务','<p>关闭窗口不会取消任务。服务运行期间可继续备课，刷新后会重新连接。</p><p class="studio-progress"></p><pre class="studio-task-events"></pre>');
    dialog.querySelector('.studio-progress').textContent=latestProgress?.progress?.title||'正在连接';dialog.querySelector('.studio-task-events').textContent=progressText();
    if(taskState==='disconnected'&&!busy&&activeTask)void reconnect(activeTask);
  }
  badge.onclick=showTask;
  function shell(title, content) {
    dialog.innerHTML = `<header><h2>${esc(title)}</h2><button class="button outline" data-studio-close>关闭</button></header>${content}`;
    dialog.querySelector('[data-studio-close]').textContent=busy?'后台继续':'关闭';
    dialog.querySelector('[data-studio-close]').onclick = () => dialog.close();
    if (!dialog.open) dialog.showModal();
  }
  function source(unit) {
    return [...(unit.source?.pages || []).map(p=>({...p,materialId:'primary'})), ...(unit.materials || []).filter(m => !m.archivedAt).flatMap(m => (m.pages || []).map(p=>({...p,materialId:m.id})))];
  }
  function taskSource(unit, target) {
    const ids=new Set([target.id,target.knowledgePointId,...(target.keyPointIds || [])]);
    const points=[target,...(unit.keyPoints || []).filter(p=>ids.has(p.id))];
    const numbers=new Set(points.flatMap(p=>[...(p.slideNumbers || []),...(p.evidence || []).map(e=>e.slideNumber)]));
    return source(unit).map((page,index)=>({page,index,priority:numbers.has(page.number)?0:1})).sort((a,b)=>a.priority-b.priority||a.index-b.index).slice(0,40).map(row=>row.page);
  }
  function save(unit, title) { commit(unit, title); render(); }
  function targetPoint(unit, id) { return unit.keyPoints?.find(p => p.id === id); }
  function planList(unit) {
    return (unit.motionPlans || []).map((plan, i) => `<article class="studio-plan"><div><b>${esc(plan.blueprint?.title || plan.title)}</b><small>${plan.status === 'stale' ? '知识点已变化，请重新规划' : plan.animationId ? '已有动画，可调整方案后生成新版本' : '待确认讲解方案'}</small><p>${esc(plan.blueprint?.teachingQuestion)}</p></div><div class="studio-actions">${plan.animationId?`<button class="button dark" data-studio-open-motion="${esc(plan.animationId)}">查看动画</button>`:''}<button class="button outline" data-studio-plan="${i}">查看并编辑方案</button></div></article>`).join('');
  }
  function render() {
    if(taskState==='completed'&&!getUnits().find(u=>u.id===activeTask?.unitId)?.pendingLocalResult)updateTask('idle');
    const unit = getUnit(); if (!unit) return;
    for (const [panel, kind] of [['knowledgePanel','knowledge'],['assessmentPanel','question'],['resourcesPanel','resource']]) {
      const host = document.getElementById(panel); if (!host) continue;
      let tools = host.querySelector('.studio-actions');
      if (!tools) { tools = document.createElement('div'); tools.className = 'studio-actions'; host.prepend(tools); }
      tools.innerHTML = `<button class="button outline" data-studio-rebuild="${kind}">局部重做${labels[kind]}</button>${kind === 'resource' ? '<button class="button dark" data-studio-new-plan>新建动效讲解方案</button>' : ''}${unit.pendingLocalResult ? '<button class="button outline" data-studio-pending>查看待应用结果</button>' : ''}${unit.motionDraftArchive?.length ? '<button class="button outline" data-studio-archive>历史草稿</button>' : ''}`;
      if (kind === 'resource') {
        let plans = host.querySelector('.studio-plans');
        if (!plans) { plans = document.createElement('section'); plans.className = 'studio-plans'; tools.after(plans); }
        plans.innerHTML = planList(unit);
      }
    }
    const review = [
      ...(unit.resources || []).map((item,index)=>({item,index,kind:'resource'})), ...(unit.animations || []).map((item,index)=>({item,index,kind:'motion'})), ...(unit.lesson?.questions || []).map((item,index)=>({item,index,kind:'question'})), ...(unit.lesson?.flow || []).map((item,index)=>({item,index,kind:'activity'})),
    ].filter(row => row.item.contentReview?.status === 'needs-review');
    const host = document.getElementById('resourcesPanel');
    if (host) {
      host.querySelector('.studio-review')?.remove();
      if (review.length) { const note = document.createElement('section'); note.className = 'studio-review'; note.innerHTML = `<h3>关联内容待核对</h3>${review.map(({item,index,kind})=>`<article class="studio-plan"><b>${esc(item.title || item.prompt || item.phase)}</b><button class="button outline" data-studio-check="${kind}:${index}">查看并核对</button></article>`).join('')}`; host.querySelector('.studio-actions')?.after(note); }
    }
  }
  async function poll(active) {
    for (;;) {
      const response = await fetch(`/api/revise-motion/${encodeURIComponent(active.jobId)}`, { cache: 'no-store' });
      const payload = await response.json();
      updateTask('running',payload);
      const progress = dialog.querySelector('.studio-progress');
      if (progress) progress.textContent = `${payload.model || active.model || ''} · ${payload.progress?.title || '正在处理'}\n${payload.progress?.detail || ''}`;
      const events=dialog.querySelector('.studio-task-events');if(events){events.textContent=progressText();events.scrollTop=events.scrollHeight;}
      if (payload.state === 'completed') return payload.result.value;
      if (payload.state === 'failed' && payload.partialResult?.value) return payload.partialResult.value;
      if (!response.ok || payload.state === 'failed') throw Object.assign(Error(payload.error || payload.message || '任务失败'), { terminal: true });
      await new Promise(resolve => setTimeout(resolve, 900));
    }
  }
  function receive(active, value) {
    const unit = getUnits().find(u => u.id === active.unitId); if (!unit) throw Error('教学单元已删除，结果未应用');
    // Persist a reviewable result before updating any authored content.
    unit.pendingLocalResult = { ...active, value };
    save(unit, '保存局部生成结果');
    activeTask=active;updateTask('completed');localStorage.setItem('zhigou:teaching-last-result',JSON.stringify({unitId:unit.id,jobId:active.jobId}));
    if(dialog.open&&dialog.querySelector('.studio-progress'))reviewResult(unit);else showToast('生成完成，点击右下角入口查看；结果已保存在所属单元');
  }
  async function reconnect(active){
    if(busy)return;busy=true;activeTask=active;updateTask('running');
    try{const unit=getUnits().find(u=>u.id===active.unitId);if(!unit)throw Object.assign(Error('所属单元已删除'),{terminal:true});
      if(unit.pendingLocalResult?.jobId===active.jobId){updateTask('completed');localStorage.removeItem(activeKey);return;}
      receive(active,await poll(active));localStorage.removeItem(activeKey);
    }catch(e){if(e.terminal)localStorage.removeItem(activeKey);updateTask(e.terminal?'failed':'disconnected',{progress:{title:e.message,detail:e.terminal?'任务已经停止，原有版本未改动。':'网络暂时不可用，任务编号仍保留；点击入口重连，不会重新提交。'}});showToast(e.message);}
    finally{busy=false;}
  }
  async function run(unit, input, metadata) {
    if (busy) return showToast('已有生成任务正在运行');
    let saved;try{saved=JSON.parse(localStorage.getItem(activeKey));}catch{}if(saved){activeTask=saved;updateTask('disconnected');showTask();return;}
    if (archivePendingResult(unit))save(unit,'将旧结果移入历史草稿');
    busy = true;
    shell('正在生成', '<p>可以关闭窗口，任务将继续在后台运行。</p><p class="studio-progress">正在提交任务…</p><pre class="studio-task-events"></pre>');
    let active;
    try {
      const response = await fetch('/api/teaching-task', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(input) });
      const accepted = await response.json(); if (!response.ok) throw Error(accepted.error || '任务提交失败');
      active = { ...metadata, sourceBaseline:fingerprint(source(unit)), kind:input.kind, unitId:unit.id, jobId:accepted.jobId, model:accepted.model };
      activeTask=active;latestProgress=null;updateTask('running');
      localStorage.setItem(activeKey, JSON.stringify(active));
      receive(active, await poll(active)); localStorage.removeItem(activeKey);
    } catch(error) {
      if (error.terminal) localStorage.removeItem(activeKey);
      updateTask(active&&!error.terminal?'disconnected':'failed',{progress:{title:error.message,detail:active&&!error.terminal?'任务信息已保存，点击重连，不会重新提交。':'原内容已保留，可调整要求后重试。'}});
      if(dialog.open&&dialog.querySelector('.studio-progress'))showTask();else showToast(error.message);
    } finally { busy = false; }
  }
  function newPlan(pointIndex = 0) {
    const unit = ensureEditable();
    if (!unit.keyPoints?.length) return showToast('请先分析或添加知识点');
    shell('新建动效讲解方案', `<label>知识点<select id="studioPoint">${unit.keyPoints.map((p,i)=>`<option value="${i}">${esc(p.title)}</option>`).join('')}</select></label><label>讲解要求<textarea id="studioPlanRequest" placeholder="希望讲清什么、学生容易卡在哪里"></textarea></label><footer><button class="button dark" id="studioPlanGenerate">生成讲解方案</button></footer>`);
    dialog.querySelector('#studioPoint').value=String(Math.max(0,pointIndex));
    dialog.querySelector('#studioPlanGenerate').onclick = () => {
      const index = Number(dialog.querySelector('#studioPoint').value), target = unit.keyPoints[index];
      run(unit, {kind:'plan',target:{...target, teacherRequest:dialog.querySelector('#studioPlanRequest').value},source:taskSource(unit,target)}, { index, baseline:fingerprint(target) });
    };
  }
  function editPlan(index, explicitUnit) {
    const unit = explicitUnit || ensureEditable(), plan = unit.motionPlans?.[index]; if (!plan) return;
    if (plan.status === 'stale') return newPlan(unit.keyPoints.findIndex(p=>p.id===plan.knowledgePointId));
    const b = plan.blueprint;
    shell('编辑讲解方案', `<div class="studio-two"><label>教学问题<textarea data-plan-field="teachingQuestion">${esc(b.teachingQuestion)}</textarea></label><label>讲解目标<textarea data-plan-field="explanationGoal">${esc(b.explanationGoal)}</textarea></label></div><label>视觉表达与布局<textarea data-plan-field="representationStrategy">${esc(b.representationStrategy)}</textarea></label><label>观看后检验问题<textarea data-plan-field="teachingCheck">${esc(b.teachingCheck)}</textarea></label><div class="studio-steps">${(b.logicSteps || []).map((step,i)=>`<section class="studio-step"><b>第 ${i+1} 步</b>${[['claim','要解释的原理'],['visibleEvidence','学生看到的变化'],['whyItMatters','与前后步骤的关系']].map(([key,label])=>`<label>${label}<textarea data-step="${i}" data-field="${key}">${esc(step[key])}</textarea></label>`).join('')}</section>`).join('')}</div><label>纠正的误解<textarea id="studioWrong">${esc(b.misconceptionCorrection?.wrongView)}</textarea></label><label>反例或对照<textarea id="studioCounter">${esc(b.misconceptionCorrection?.counterEvidence)}</textarea></label><footer><button class="button outline" id="studioSavePlan">保存方案</button><button class="button dark" id="studioRenderPlan">确认方案并生成动画</button></footer>`);
    const extra=document.createElement('details');extra.innerHTML=`<summary>画面阶段与动作</summary>${(b.phases || []).map((phase,i)=>`<label>阶段 ${i+1}：${esc(phase.label)}<textarea data-phase-focus="${i}">${esc(phase.focus)}</textarea></label>`).join('')}${(b.motionSequence || []).map((step,i)=>`<section class="studio-step"><b>动作 ${i+1}</b>${[['action','动作'],['visibleChange','可见变化'],['proves','证明什么']].map(([key,label])=>`<label>${label}<textarea data-sequence="${i}" data-key="${key}">${esc(step[key])}</textarea></label>`).join('')}</section>`).join('')}`;dialog.querySelector('footer').before(extra);
    if(b.sourceBoundary || b.assumptions?.length || b.reviewNotes?.length){const notes=document.createElement('section');notes.className='studio-step';notes.innerHTML=`<b>依据与演示假设</b><p>${esc(b.sourceBoundary)}</p><ul>${[...(b.assumptions || []),...(b.reviewNotes || [])].map(s=>`<li>${esc(s)}</li>`).join('')}</ul>`;dialog.querySelector('.studio-steps').before(notes);}
    const stepHost=dialog.querySelector('.studio-steps');
    function stepControls(card){const controls=document.createElement('div');controls.className='studio-actions';controls.innerHTML='<button type="button" class="button outline" data-step-up>上移</button><button type="button" class="button outline" data-step-down>下移</button><button type="button" class="button outline" data-step-remove>删除此步</button>';card.append(controls);controls.onclick=e=>{if(e.target.hasAttribute('data-step-up')&&card.previousElementSibling)stepHost.insertBefore(card,card.previousElementSibling);if(e.target.hasAttribute('data-step-down')&&card.nextElementSibling)stepHost.insertBefore(card.nextElementSibling,card);if(e.target.hasAttribute('data-step-remove')){if(stepHost.children.length<=3)return showToast('请保留至少三个解释步骤');card.remove();}renumber();};}
    function renumber(){[...stepHost.children].forEach((card,i)=>{card.querySelector('b').textContent=`第 ${i+1} 步`;card.querySelectorAll('[data-step]').forEach(el=>el.dataset.step=i);});}
    stepHost.querySelectorAll('.studio-step').forEach(stepControls);
    const add=document.createElement('button');add.className='button outline';add.type='button';add.textContent='添加讲解步骤';stepHost.after(add);add.onclick=()=>{const card=document.createElement('section');card.className='studio-step';card.innerHTML='<b></b>'+[['claim','要解释的原理'],['visibleEvidence','学生看到的变化'],['whyItMatters','与前后步骤的关系']].map(([key,label])=>`<label>${label}<textarea data-step="0" data-field="${key}"></textarea></label>`).join('');stepHost.append(card);stepControls(card);renumber();};
    const collect = () => {
      const next = structuredClone(b);
      dialog.querySelectorAll('[data-plan-field]').forEach(el=>{next[el.dataset.planField]=el.value.trim();});
      next.logicSteps=[...stepHost.children].map(card=>Object.fromEntries([...card.querySelectorAll('[data-step]')].map(el=>[el.dataset.field,el.value.trim()])));
      dialog.querySelectorAll('[data-phase-focus]').forEach(el=>{next.phases[Number(el.dataset.phaseFocus)].focus=el.value.trim();});
      dialog.querySelectorAll('[data-sequence]').forEach(el=>{next.motionSequence[Number(el.dataset.sequence)][el.dataset.key]=el.value.trim();});
      next.misconceptionCorrection = {wrongView:dialog.querySelector('#studioWrong').value.trim(),counterEvidence:dialog.querySelector('#studioCounter').value.trim()};
      return next;
    };
    const savePlan = () => { const next=collect(); plan.history=[...(plan.history || []),structuredClone(plan.blueprint)]; plan.blueprint=next; plan.status='draft'; save(unit,'修改动效讲解方案'); return next; };
    dialog.querySelector('#studioSavePlan').onclick=()=>{savePlan();dialog.close();showToast('方案已保存');};
    dialog.querySelector('#studioRenderPlan').onclick=()=>{
      const next=savePlan(), target=targetPoint(unit,plan.knowledgePointId);
      if(unit.pendingLocalResult?.kind==='render'&&archivePendingResult(unit))save(unit,'保留旧草稿并启动新绘制');
      if (!target) return showToast('关联知识点已不存在，请重新规划');
      run(unit,{kind:'render',approved:true,target,source:taskSource(unit,target),blueprint:next},{planIndex:index,baseline:fingerprint(target),planBaseline:fingerprint(next)});
    };
  }
  function rebuild(kind) {
    const unit=ensureEditable(), items=kind==='knowledge'?unit.keyPoints:kind==='question'?unit.lesson.questions:unit.resources.filter(r=>r.type!=='motion');
    if (!items?.length) return showToast(`当前没有可重做的${labels[kind]}`);
    shell(`局部重做${labels[kind]}`, `<label>选择条目<select id="studioTarget">${items.map(item=>{const index=(kind==='knowledge'?unit.keyPoints:kind==='question'?unit.lesson.questions:unit.resources).indexOf(item);return `<option value="${index}">${esc(item.title || item.prompt || item.question)}</option>`;}).join('')}</select></label><label>修改要求<textarea id="studioInstruction" placeholder="说明不准确的地方，或希望补充的内容"></textarea></label><footer><button class="button dark" id="studioRebuild">生成修改结果</button></footer>`);
    dialog.querySelector('#studioRebuild').onclick=()=>{
      const index=Number(dialog.querySelector('#studioTarget').value),target=localTarget(unit,kind,index),instruction=dialog.querySelector('#studioInstruction').value.trim();
      if(!instruction)return showToast('请填写修改要求');
      run(unit,{kind,target,instruction,source:taskSource(unit,target)},{index,baseline:fingerprint(target)});
    };
  }
  function reviewResult(unit) {
    const pending=unit.pendingLocalResult;if(!pending)return;
    const isPlan=pending.kind==='plan', isRender=pending.kind==='render';
    const current=isPlan?unit.keyPoints[pending.index]:isRender?targetPoint(unit,pending.value.knowledgePointId):localTarget(unit,pending.kind,pending.index);
    const impacts=pending.kind==='knowledge'?relatedItems(unit,current?.id):[];
    const conflict=resultConflict(unit,pending,source(unit));
    shell('查看生成结果', `${isPlan ? `<h3>${esc(pending.value.blueprint?.title)}</h3><p>${esc(pending.value.blueprint?.teachingQuestion)}</p><ol>${(pending.value.blueprint?.logicSteps || []).map(s=>`<li><b>${esc(s.claim)}</b><p>${esc(s.visibleEvidence)}</p></li>`).join('')}</ol>` : isRender ? '<section id="studioDraftReview"></section><div id="studioGeneratedScene"></div><label>试播进度<input id="studioDraftProgress" type="range" min="0" max="1000" value="0"></label>' : `<div class="studio-two"><section><h3>当前内容</h3><pre>${esc(describe(current))}</pre></section><section><h3>生成结果</h3><pre>${esc(describe(pending.value))}</pre></section></div>`}${impacts.length?`<p class="studio-review">应用后以下内容将标记为待核对：${impacts.map(r=>esc(r.item.title || r.item.prompt || r.item.phase)).join('、')}</p><p>需要同步重做的资源，可应用后通过“局部重做”逐项选择。</p>`:''}<footer><button class="button outline" id="studioDiscard">暂不使用，移入历史</button><button class="button dark" id="studioApply">${isPlan?'保存并编辑方案':isRender?'保存动画版本':'应用到当前条目'}</button></footer>`);
    if(isRender) {
      const drafts=pending.value.generationDrafts||[], host=dialog.querySelector('#studioDraftReview'), el=dialog.querySelector('#studioGeneratedScene');
      host.innerHTML='<p>草稿已保存。未通过检查不代表成果丢失；保存后可在动画详情中继续修改。</p>'+(drafts.length?'<label>绘制记录<select id="studioDraftSelect">'+drafts.map((d,i)=>'<option value="'+i+'" '+(d.id===pending.value.selectedDraftId?'selected':'')+'>第 '+d.attempt+' 次绘制'+(!d.scene?' · 无法安全预览':'')+'</option>').join('')+'</select></label>':'')+'<div id="studioDraftIssues"></div>';
      function preview(){
        const scene=pending.value.scene, q=pending.value.generationQuality||{};
        dialog.querySelector('#studioApply').disabled=!scene||!!conflict;
        dialog.querySelector('#studioApply').textContent=scene?'保存为待审核版本':'此草稿无法安全播放';
        el.innerHTML=scene?renderScene(scene):'<p>原始输出已隔离保存在本地任务记录，不会执行。请调整讲解方案后重新绘制。</p>';
        const issueBox=dialog.querySelector('#studioDraftIssues');
        issueBox.innerHTML=[...(q.blockers||[]),...(q.warnings||[])].map(x=>'<p class="runtime-warning">'+esc(x)+'</p>').join('');
        dialog.querySelector('#studioDraftProgress').value='0';
        if(scene)requestAnimationFrame(()=>{
          if(pending.value.scene!==scene)return;
          pending.value.runtimeCheck=inspectSceneFrames(el,scene);
          const check=pending.value.runtimeCheck;
          issueBox.innerHTML+='<p>'+esc(check.passed?'采样阶段有可见图形；知识原理仍待教师核对。':'部分阶段画面为空，保存后请继续修改。')+'</p>'+(check.warnings||[]).map(w=>'<p class="runtime-warning">'+esc(w.object+'：'+w.detail+'（进度 '+w.at.join('/')+'%）')+'</p>').join('');
        });
      }
      dialog.querySelector('#studioDraftSelect')?.addEventListener('change',e=>{
        const d=drafts[Number(e.target.value)];
        Object.assign(pending.value,{scene:d.scene,generationQuality:d.quality,selectedDraftId:d.id,runtimeCheck:null});
        save(unit,'选择动效草稿');preview();
      });
      dialog.querySelector('#studioDraftProgress').oninput=e=>{if(pending.value.scene)applySceneProgress(el,pending.value.scene,Number(e.target.value)/1000,{});};
      const adjust=document.createElement('button');adjust.type='button';adjust.className='button outline';adjust.textContent='保留草稿并调整方案';
      adjust.onclick=()=>editPlan(pending.planIndex,unit);dialog.querySelector('footer').prepend(adjust);
      preview();
    }
    if(conflict){const note=document.createElement('p');note.className='runtime-warning';note.setAttribute('role','status');note.textContent=conflict;dialog.querySelector('header').after(note);dialog.querySelector('#studioApply').disabled=true;}
    dialog.querySelector('#studioDiscard').onclick=()=>{archivePendingResult(unit);save(unit,'归档生成结果');dialog.close();showToast('已移入历史草稿，之后仍可查看');};
    dialog.querySelector('#studioApply').onclick=()=>{
      try {
        const latestConflict=resultConflict(unit,pending,source(unit));if(latestConflict)throw Error(latestConflict);
        if(isPlan || isRender) {
          if(isRender&&!pending.value.scene)throw Error('此草稿不能安全播放，请修改后再保存为动画');
          if(fingerprint(current)!==pending.baseline)throw Error('关联知识点已变化，请重新生成');
          if(isPlan){unit.motionPlans ||= [];const old=unit.motionPlans.find(p=>p.knowledgePointId===pending.value.knowledgePointId);const next={...pending.value,id:old?.id || crypto.randomUUID(),animationId:old?.animationId,history:[...(old?.history || []),...(old?[old.blueprint]:[])]};if(old)unit.motionPlans[unit.motionPlans.indexOf(old)]=next;else unit.motionPlans.push(next);}
          else {
            const plan=unit.motionPlans?.[pending.planIndex];
            if(!plan || fingerprint(plan.blueprint)!==pending.planBaseline)throw Error('讲解方案已修改，请重新生成动画');
            unit.animations ||= [];
            const old=unit.animations.find(m=>m.id===plan.animationId), id=old?.id || crypto.randomUUID();
            const versions=old?.versions || (old?[{...old,versionNumber:1}]:[]), number=versions.length+1;
            const motion={...pending.value,id,activityRefs:old?.activityRefs || [],revisionJobId:pending.jobId};
            const snapshot={...motion,versionNumber:number,createdAt:new Date().toLocaleString('zh-CN'),revisionInstruction:'按确认讲解方案生成'};
            const root={...motion,versions:[...versions,snapshot],currentVersion:number};
            if(old)unit.animations[unit.animations.indexOf(old)]=root;else unit.animations.push(root);
            plan.animationId=id;plan.status='rendered';
          }
          unit.pendingLocalResult=null;
        } else applyLocalResult(unit,pending);
        save(unit,isPlan?'保存动效讲解方案':isRender?'保存动效新版本':'应用局部修改');
        if(isPlan)editPlan(unit.motionPlans.findIndex(p=>p.knowledgePointId===pending.value.knowledgePointId),unit);else {dialog.close();showToast('已保存，可在当前单元查看');}
      } catch(error){showToast(error.message);}
    };
  }
  function compare() {
    const selected=getMotion(),root=getUnit().animations?.find(m=>m.id===(selected?.rootId || selected?.id));
    const versions=root?.versions || [];if(versions.length<2)return showToast('至少两个版本才能对照');
    shell('动效版本对照', `<div class="studio-two">${['left','right'].map((side,i)=>`<section><label>版本<select data-compare-side="${side}">${versions.map(v=>`<option value="${v.versionNumber}" ${v.versionNumber===(i?versions.at(-1).versionNumber:versions[0].versionNumber)?'selected':''}>第 ${v.versionNumber} 版 · ${esc(v.revisionInstruction)}</option>`).join('')}</select></label><div class="studio-compare-stage" id="compare-${side}"></div></section>`).join('')}</div><label>同步查看进度<input id="studioCompareProgress" type="range" min="0" max="1000" value="0"></label>`);
    function update(){for(const side of ['left','right']){const number=Number(dialog.querySelector(`[data-compare-side="${side}"]`).value),v=versions.find(v=>v.versionNumber===number),el=dialog.querySelector(`#compare-${side}`);let frame=el.querySelector('iframe');const seek=()=>{if(frame.contentDocument?.querySelector('svg'))applySceneProgress(frame.contentDocument.body,v.scene,Number(dialog.querySelector('#studioCompareProgress').value)/1000,{});};if(el.dataset.version!==String(number)){el.dataset.version=number;frame=document.createElement('iframe');frame.title=`第 ${number} 版动画`;frame.setAttribute('sandbox','allow-same-origin');frame.style.cssText='width:100%;height:360px;border:0';frame.srcdoc=`<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}svg{width:100%;height:350px}</style></head><body>${standaloneSvg(v.scene)}</body></html>`;el.replaceChildren(frame);frame.onload=seek;}else seek();}}
    dialog.querySelectorAll('select,input').forEach(el=>el.oninput=update);update();
  }
  document.addEventListener('click',event=>{
    const el=event.target.closest('button');if(!el)return;
    if(el.hasAttribute('data-studio-rebuild'))rebuild(el.dataset.studioRebuild);
    if(el.hasAttribute('data-studio-new-plan'))newPlan();
    if(el.hasAttribute('data-studio-plan'))editPlan(Number(el.dataset.studioPlan));
    if(el.hasAttribute('data-studio-pending'))reviewResult(getUnit());
    if(el.hasAttribute('data-studio-archive')){
      const unit=getUnit();
      shell('历史生成结果','<p>历史草稿不会覆盖当前动画；修改过知识点或方案的草稿仅供参考。</p>'+unit.motionDraftArchive.map((p,i)=>'<button class="button outline" data-archive-index="'+i+'">'+esc(p.value.title||p.value.prompt||p.value.blueprint?.title||'生成结果')+' · 草稿 '+(i+1)+'</button>').join(''));
      dialog.querySelectorAll('[data-archive-index]').forEach(button=>button.onclick=()=>{
        const i=Number(button.dataset.archiveIndex), old=unit.pendingLocalResult, selected=unit.motionDraftArchive.splice(i,1)[0];
        if(old)unit.motionDraftArchive.push(old);unit.pendingLocalResult=selected;save(unit,'查看历史动效草稿');reviewResult(unit);
      });
    }
    if(el.hasAttribute('data-studio-open-motion'))onOpenMotion?.(el.dataset.studioOpenMotion);
    if(el.hasAttribute('data-studio-check')){
      const unit=getUnit(),[kind,rawIndex]=el.dataset.studioCheck.split(':'),index=Number(rawIndex),item=kind==='motion'?unit.animations[index]:kind==='activity'?unit.lesson.flow[index]:localTarget(unit,kind,index);
      shell('核对关联内容',`<h3>${esc(item.title || item.prompt || item.phase)}</h3><pre style="white-space:pre-wrap">${esc(kind==='activity'?`${item.teacherAction}\n${item.studentAction}`:describe(item))}</pre>${kind==='motion'?'<div id="studioReviewScene"></div>':''}<footer><button class="button outline" id="studioRelatedRebuild">${kind==='motion'?'重新规划动效':kind==='activity'?'编辑课堂环节':'局部重做'}</button><button class="button dark" id="studioConfirmRelated">内容仍适用</button></footer>`);
      if(kind==='motion'){const el=dialog.querySelector('#studioReviewScene');el.innerHTML=renderScene(item.scene);applySceneProgress(el,item.scene,.5,{});}
      dialog.querySelector('#studioConfirmRelated').onclick=()=>{item.contentReview={status:'verified',at:new Date().toISOString()};save(unit,'核对关联内容');dialog.close();};
      dialog.querySelector('#studioRelatedRebuild').onclick=()=>{dialog.close();if(kind==='motion')newPlan();else if(kind==='activity'){document.querySelector('[data-unit-tab="lesson"]')?.click();showToast('点击“编辑本节”调整课堂环节');}else rebuild(kind);};
    }
  });
  const phaseList=document.getElementById('motionPhases');
  function enhanceMotion() {
    selectedPhase=-1;
    phaseList?.querySelectorAll('li').forEach((li,i)=>{li.tabIndex=0;li.setAttribute('role','button');li.classList.add('studio-phase-button');const select=()=>{selectedPhase=i;phaseList.querySelectorAll('li').forEach((n,j)=>n.classList.toggle('active',i===j));const phase=getMotion()?.scene?.phases?.[i],input=document.getElementById('timelineRange');if(phase&&input){input.value=(phase.at||0)*1000;input.dispatchEvent(new Event('input'));}showToast(`已选择第 ${i+1} 步，填写要求后点击“修改这一段”`);};li.onclick=select;li.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select();}};});
  }
  if(phaseList)new MutationObserver(enhanceMotion).observe(phaseList,{childList:true});
  const revision=document.getElementById('reviseMotion');
  if(revision){const button=document.createElement('button');button.className='button outline';button.type='button';button.textContent='版本对照';button.onclick=compare;revision.before(button);revision.addEventListener('click',()=>{if(selectedPhase<0)return;const phase=getMotion()?.scene?.phases?.[selectedPhase],field=document.getElementById('motionRevision');if(!field.value.trim())return;field.value=`重点修改第 ${selectedPhase+1} 步（${phase?.label || ''}，进度 ${phase?.at || 0}）：${field.value}\n保留其他阶段的知识事实与已有效的表达，完整输出可播放动画。`;},{capture:true});}
  let scheduled=false;
  const observer=new MutationObserver(()=>{if(scheduled)return;scheduled=true;queueMicrotask(()=>{observer.disconnect();render();scheduled=false;observe();});});
  function observe(){for(const id of ['knowledgePanel','assessmentPanel','resourcesPanel']){const el=document.getElementById(id);if(el)observer.observe(el,{childList:true});}}
  observe();render();
  void (async()=>{let active,last;try{active=JSON.parse(localStorage.getItem(activeKey));last=JSON.parse(localStorage.getItem('zhigou:teaching-last-result'));}catch{}if(active)return reconnect(active);if(last&&getUnits().find(u=>u.id===last.unitId)?.pendingLocalResult?.jobId===last.jobId){activeTask=last;updateTask('completed');}})();
  return { render };
}
