import {caseReport,addCaseReview,addCaseRun,buildCaseHtml,updateCaseRun,withdrawCaseRun,restoreCaseRun} from './teaching-case.js';
import {readCaseDraft,writeCaseDraft,compatibleCaseDraft} from './case-drafts.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function setupTeachingCase({getUnit,onSave,showToast,onOpenTarget}){
  const style=document.createElement('link');style.rel='stylesheet';style.href='/teaching-case.css';document.head.append(style);
  const editStyle=document.createElement('link');editStyle.rel='stylesheet';editStyle.href='/case-record-editor.css';document.head.append(editStyle);
  const dialog=document.createElement('dialog');dialog.id='teachingCaseDialog';dialog.className='create-dialog';document.body.append(dialog);
  let unitId,targets=[],draft={fields:{},reviews:{}};
  const input=(label,name,value='',type='text')=>`<label>${label}<input name="${name}" type="${type}" ${type==='number'?'min="0" step="0.1"':''} value="${esc(value)}"></label>`;
  const value=name=>dialog.querySelector(`[name="${name}"]`).value;
  function current(){const u=getUnit();if(u.id!==unitId)throw Error('当前教学单元已切换，请重新打开');if(u.isDemo)throw Error('请先复制为个人单元，再记录真实审核与使用情况');return u;}
  function persistDraft(){
    const unit=getUnit();if(unit.id!==unitId||unit.isDemo)return;
    const ok=writeCaseDraft(localStorage,unitId,{...draft,contextBase:JSON.stringify(unit.teachingContext||{})});
    const status=dialog.querySelector('[data-draft-status]');if(status)status.textContent=ok?'草稿已保存到本机':'草稿未保存：本机存储不可用，请先复制未保存内容';
  }
  function captureDraft(){
    for(const input of dialog.querySelectorAll('[name]'))draft.fields[input.name]=input.value;
    for(const row of dialog.querySelectorAll('[data-case-target]')){const t=targets[Number(row.dataset.caseTarget)];draft.reviews[t.id]={fingerprint:t.fingerprint,reviewer:row.querySelector('[data-reviewer]').value,note:row.querySelector('[data-review-note]').value,checks:Object.fromEntries([...row.querySelectorAll('[data-review-check]')].map(c=>[c.dataset.reviewCheck,c.checked])),expanded:row.open};}
    persistDraft();
  }
  function clearFields(names){for(const n of names)delete draft.fields[n];persistDraft();}
  function open(){
    const u=getUnit(),r=caseReport(u);unitId=u.id;targets=r.targets;
    draft=compatibleCaseDraft(readCaseDraft(localStorage,unitId),u,targets);
    dialog.innerHTML=`<div class="dialog-shell"><header><h2>案例与审核</h2><button type="button" data-case-close>关闭</button></header><div class="dialog-body"><small data-draft-status role="status"></small><p>${r.gaps.length} 项待处理 · 自动检查不代替教师审核</p><details><summary>查看待处理事项</summary><ul>${r.gaps.map(g=>`<li>${esc(g)}</li>`).join('')}</ul></details><section><h3>教学场景</h3>${input('学生基础','audience',u.teachingContext?.audience||'')}${input('应用场景','scenario',u.teachingContext?.scenario||'')}<button type="button" data-save-context>保存场景</button></section><section><h3>内容审核</h3><p>请先在知识页或动效实验室查看完整内容，再填写意见。内容修改后需重新审核。</p>${r.targets.map((t,i)=>`<details class="case-target" data-case-target="${i}"><summary>${esc(t.kind)} · ${esc(t.title)} · ${esc(t.review.label)}</summary><p>${esc(t.detail)}</p>${t.automatic?`<p>自动结构检查：${t.automatic.ready?'未发现阻塞项（不代表原理正确）':esc(t.automatic.blockers.map(x=>x.label).join('、'))}</p>`:''}<label>审核人<input data-reviewer></label><label>审核意见<textarea data-review-note rows="3" placeholder="核对了什么，哪里需要修改"></textarea></label>${[['facts','事实与来源一致'],['logic','原理步骤与条件正确'],['clarity','表达可理解且没有遗漏关键变化']].map(([k,l])=>`<label class="case-check"><input type="checkbox" data-review-check="${k}">${l}</label>`).join('')}<button type="button" data-review-status="needs-revision">记录需修改</button><button type="button" data-review-status="approved">教师确认通过</button></details>`).join('')||'<p>尚无可审核内容。</p>'}</section><section><h3>使用记录</h3><label>记录类型<select name="kind"><option value="trial">试运行</option><option value="classroom">真实课堂</option></select></label>${input('日期','date',new Date().toLocaleDateString('sv-SE'),'date')}<div class="case-times">${input('材料准备 分钟','preparation','','number')}${input('等待及重试 分钟','waiting','','number')}${input('人工修订 分钟','revision','','number')}</div><small>未知请留空，不按零计算；不记录或推算虚构的节省比例。</small>${input('实际使用模型 可选','model')}${input('最终采用内容','adopted')}<label>具体观察<textarea name="observation" rows="3"></textarea></label>${input('证据位置或记录编号 请勿填写学生个人信息','evidence')}<button type="button" data-save-run>保存使用记录</button><p>已保存 ${r.runs.length} 条记录</p>${r.runs.map(x=>`<details><summary>${esc(x.date)} · ${x.kind==='classroom'?'真实课堂':'试运行'} · ${x.total===null?'耗时未完整记录':`${x.total} 分钟`}</summary><p>${esc(x.observation)}</p><p>${esc(x.evidence)}</p><button type="button" data-edit-run="${esc(x.id)}">更正</button><button type="button" data-withdraw-run="${esc(x.id)}">撤回</button>${(x.history||[]).length?`<details><summary>更正历史 ${(x.history||[]).length} 次</summary>${x.history.map(h=>`<p>${esc(h.date)} · ${esc(h.observation)}</p>`).join('')}</details>`:''}</details>`).join('')}</section><p data-case-error role="alert"></p></div><footer><button type="button" data-case-export>导出案例记录</button></footer></div>`;
    const withdrawn=(u.caseRuns||[]).filter(x=>x.withdrawnAt);
    if(withdrawn.length)dialog.querySelector('.dialog-body').insertAdjacentHTML('beforeend',`<details><summary>已撤回记录 ${withdrawn.length} 条</summary>${withdrawn.map(x=>`<p>${esc(x.date)} · ${esc(x.observation)} <button type="button" data-restore-run="${esc(x.id)}">恢复记录</button></p>`).join('')}</details>`);
    dialog.querySelectorAll('[data-case-target]').forEach(row=>{const button=document.createElement('button');button.type='button';button.textContent='查看原内容';row.querySelector('summary').after(button);button.onclick=()=>{captureDraft();dialog.close();onOpenTarget?.(targets[Number(row.dataset.caseTarget)]);};});
    for(const field of dialog.querySelectorAll('[name]'))if(Object.hasOwn(draft.fields,field.name))field.value=draft.fields[field.name];
    for(const row of dialog.querySelectorAll('[data-case-target]')){const saved=draft.reviews[targets[Number(row.dataset.caseTarget)].id];if(!saved)continue;row.open=!!saved.expanded;row.querySelector('[data-reviewer]').value=saved.reviewer||'';row.querySelector('[data-review-note]').value=saved.note||'';row.querySelectorAll('[data-review-check]').forEach(c=>c.checked=saved.checks?.[c.dataset.reviewCheck]===true);}
    dialog.oninput=captureDraft;dialog.onchange=captureDraft;
    dialog.querySelector('[data-case-close]').onclick=()=>{captureDraft();dialog.close();};
    dialog.oncancel=captureDraft;
    const safe=fn=>()=>{try{fn();}catch(e){dialog.querySelector('[data-case-error]').textContent=e.message;}};
    dialog.querySelector('[data-save-context]').onclick=safe(()=>{const unit=current();unit.teachingContext={audience:value('audience').trim(),scenario:value('scenario').trim()};onSave('更新教学场景');clearFields(['audience','scenario']);open();showToast('教学场景已保存');});
    dialog.querySelectorAll('[data-review-status]').forEach(b=>b.onclick=safe(()=>{const row=b.closest('[data-case-target]'),target=targets[Number(row.dataset.caseTarget)];addCaseReview(current(),{targetId:target.id,fingerprint:target.fingerprint,status:b.dataset.reviewStatus,reviewer:row.querySelector('[data-reviewer]').value,note:row.querySelector('[data-review-note]').value,checks:Object.fromEntries([...row.querySelectorAll('[data-review-check]')].map(c=>[c.dataset.reviewCheck,c.checked]))});onSave('记录教师内容审核');delete draft.reviews[target.id];persistDraft();open();showToast('审核意见已保存并绑定当前内容');}));
    dialog.querySelector('[data-save-run]').onclick=safe(()=>{addCaseRun(current(),Object.fromEntries(['kind','date','preparation','waiting','revision','model','adopted','observation','evidence'].map(k=>[k,value(k)])));onSave('记录教学使用情况');clearFields(['kind','date','preparation','waiting','revision','model','adopted','observation','evidence']);open();showToast('使用记录已保存');});
    dialog.querySelectorAll('[data-edit-run]').forEach(b=>b.onclick=safe(()=>editRun(b.dataset.editRun)));
    dialog.querySelectorAll('[data-restore-run]').forEach(b=>b.onclick=safe(()=>{restoreCaseRun(current(),b.dataset.restoreRun);onSave('恢复使用记录');open();showToast('记录已恢复');}));
    dialog.querySelectorAll('[data-withdraw-run]').forEach(b=>b.onclick=safe(()=>{if(!confirm('撤回这条使用记录？记录会保留，但不再计入当前案例或导出成果。'))return;withdrawCaseRun(current(),b.dataset.withdrawRun);onSave('撤回使用记录');open();showToast('记录已撤回，原始数据保留');}));
    dialog.querySelector('[data-case-export]').onclick=()=>{const unit=getUnit();const url=URL.createObjectURL(new Blob([buildCaseHtml(unit)],{type:'text/html;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`${(unit.title||'教学单元').replace(/[\\/:*?"<>|]/g,'-')}-应用案例.html`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
    if(!dialog.open)dialog.showModal();
  }
  function editRun(id){
    const record=current().caseRuns.find(r=>r.id===id),expected=JSON.stringify(record),edit=document.createElement('dialog');edit.className='case-run-edit';
    edit.innerHTML=`<form><h2>更正使用记录</h2><label>记录类型<select name="kind"><option value="trial">试运行</option><option value="classroom">真实课堂</option></select></label>${input('日期','date',record.date,'date')}${['preparation','waiting','revision'].map((k,i)=>input(['材料准备 分钟','等待及重试 分钟','人工修订 分钟'][i],k,record[k]??'','number')).join('')}${input('实际使用模型','model',record.model)}${input('采用内容','adopted',record.adopted)}<label>观察记录<textarea name="observation" rows="4">${esc(record.observation)}</textarea></label>${input('证据位置','evidence',record.evidence)}<p role="alert"></p><button type="button" data-cancel-edit>取消</button><button type="submit">保存更正</button></form>`;
    document.body.append(edit);edit.querySelector('[name=kind]').value=record.kind;
    edit.querySelector('[data-cancel-edit]').onclick=()=>edit.close();edit.onclose=()=>edit.remove();
    edit.querySelector('form').onsubmit=e=>{e.preventDefault();try{updateCaseRun(current(),id,Object.fromEntries(new FormData(e.target)),expected);onSave('更正使用记录');edit.close();open();showToast('更正已保存，原记录保留在历史中');}catch(error){edit.querySelector('[role=alert]').textContent=error.message;}};
    edit.showModal();
  }
  const host=document.querySelector('#overviewPanel');
  function mount(){if(!host||host.querySelector('[data-open-case]'))return;const button=document.createElement('button');button.type='button';button.className='button outline';button.dataset.openCase='';button.textContent='案例与审核';button.onclick=open;host.prepend(button);}
  new MutationObserver(mount).observe(host,{childList:true});mount();
}
