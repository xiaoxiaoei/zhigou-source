// Static review mode never sends files, credentials, or model requests.
(()=>{
  const message='这是效果展示版，不进行在线 AI 生成。请查看已有示例、播放动效，或编辑课堂安排。';
  const json=(body,status=200)=>Promise.resolve(new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}}));
  window.fetch=(input)=>{
    const url=new URL(typeof input==='string'?input:input.url,location.href);
    if(url.pathname.endsWith('/api/capabilities'))return json({modelReady:false,runtime:'效果展示版',maxPptxSizeMb:50,maxSlideCount:200,maxExtractedTextChars:250000,models:{},formats:[]});
    return json({error:message,message,code:'STATIC_REVIEW_MODE'},403);
  };
  function notice(){const el=document.getElementById('reviewNotice');if(el){el.textContent=message;el.hidden=false;setTimeout(()=>el.hidden=true,5000);}}
  const blocked=/生成|重新分析|创建并分析|补充材料|上传|识别|模型与 API|修改这一段|按体检结果修改/;
  document.addEventListener('click',event=>{
    const target=event.target.closest('button,label.upload-zone,a');
    if(!target)return;
    if(target.dataset.reviewTab){
      event.preventDefault();event.stopImmediatePropagation();
      document.querySelector('#focusOpenButton')?.click();
      document.querySelector(`[data-unit-tab="${target.dataset.reviewTab}"]`)?.click();return;
    }
    if(target.dataset.reviewReset!==undefined){
      if(confirm('恢复展示示例？这会清除你在此展示页的编辑记录。')){
        for(const key of Object.keys(localStorage))if(key.startsWith('zhigou-'))localStorage.removeItem(key);
        location.reload();
      }return;
    }
    if(target.dataset.reviewMotion!==undefined){
      document.querySelector('#focusOpenButton')?.click();
      document.querySelector('[data-unit-tab="resources"]')?.click();
      const btn=document.querySelector('#resourcesPanel [data-open-motion]');
      if(btn)btn.click();return;
    }
    if(blocked.test(target.textContent)||target.matches('[data-create-source],#createUnitButton,#reviseMotion')){
      event.preventDefault();event.stopImmediatePropagation();notice();
    }
  },true);
  document.addEventListener('change',event=>{if(event.target.matches('input[type=file]')){event.stopImmediatePropagation();event.target.value='';notice();}},true);
  document.addEventListener('drop',event=>{event.preventDefault();event.stopImmediatePropagation();notice();},true);
  document.addEventListener('DOMContentLoaded',()=>{
    const shortcuts=[['knowledge','知识与难点','查看知识逻辑与常见误解'],['lesson','教学设计','查看课堂活动与教学目标'],['resources','资源工坊','播放动效、查看代码和实验'],['timeline','课堂时间轴','调整课堂安排并进入授课模式']];
    document.querySelectorAll('.start-card').forEach((el,i)=>{
      const [tab,title,description]=shortcuts[i];el.dataset.reviewTab=tab;
      el.innerHTML=`<strong>${title}</strong><p>${description}</p>`;
    });
    const bar=document.createElement('section');bar.className='review-bar';
    bar.innerHTML='<div><strong>知构 · 效果展示</strong><span>预置案例，可播放、查看与编辑；不调用 AI，不上传材料。</span></div><div><button type="button" data-review-motion>查看示例动效</button><button type="button" data-review-reset>恢复示例</button></div>';
    document.body.prepend(bar);
    const noticeEl=document.createElement('p');noticeEl.id='reviewNotice';noticeEl.setAttribute('role','status');noticeEl.hidden=true;document.body.append(noticeEl);
  });
})();
