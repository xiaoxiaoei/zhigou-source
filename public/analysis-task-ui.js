export function setupAnalysisTaskUI({onPartial,onCancel}){
  const dialog=document.querySelector('#analysisDialog'),host=dialog.querySelector('.analysis-shell');
  const actions=document.createElement('div');actions.className='analysis-actions';actions.innerHTML='<button type="button" data-background>后台继续</button><button type="button" data-partial disabled>查看已完成内容</button><button type="button" data-cancel>停止后续生成</button><span role="status" data-clock></span>';host.append(actions);
  const badge=document.createElement('button');badge.className='task-status-button';badge.hidden=true;document.body.append(badge);
  let latest=null,started=Date.now(),active=false;
  badge.onclick=()=>dialog.showModal();actions.querySelector('[data-background]').onclick=()=>dialog.close();
  actions.querySelector('[data-partial]').onclick=()=>{if(latest?.partialResult){onPartial(latest.partialResult);dialog.close();}};
  actions.querySelector('[data-cancel]').onclick=async()=>{if(confirm('停止后续生成？已完成内容会保留，已经发出的模型请求可能仍产生费用。')){await onCancel();}};
  setInterval(()=>{if(active)actions.querySelector('[data-clock]').textContent=`已等待 ${Math.floor((Date.now()-started)/1000)} 秒`;},1000);
  return {update(payload){latest=payload;if(!active){started=Date.now();active=true;}badge.hidden=false;badge.textContent=payload.progress?.title||'正在分析';actions.querySelector('[data-partial]').disabled=!payload.partialResult?.analysis?.keyPoints?.length;if(['completed','failed'].includes(payload.state)){active=false;badge.hidden=true;}},finish(){active=false;badge.hidden=true;}};
}
