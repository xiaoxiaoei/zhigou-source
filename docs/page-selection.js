import {parsePageRange,formatPageRange} from './page-range.js';
import {createPageThumbnails} from './page-thumbnails.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createPageSelection({getFile,onError,onReady}){
  let preview=null,pending=null,selection=[],disposeThumbnails;
  const host=document.createElement('section');host.id='pageSelection';host.hidden=true;document.querySelector('[data-source-pane="ppt"]').append(host);
  const style=document.createElement('link');style.rel='stylesheet';style.href='./page-selection.css';document.head.append(style);
  const thumbnailsStyle=document.createElement('link');thumbnailsStyle.rel='stylesheet';thumbnailsStyle.href='./page-thumbnails.css';document.head.append(thumbnailsStyle);
  function reset(){disposeThumbnails?.();disposeThumbnails=null;pending?.abort();pending=null;preview=null;selection=[];host.hidden=true;host.innerHTML='';}
  function update(fromRange=false){
    try{
      if(fromRange)selection=parsePageRange(host.querySelector('#analysisPageRange').value,preview.totalPages);
      const chosen=new Set(selection),characters=preview.pages.filter(p=>chosen.has(p.number)).reduce((n,p)=>n+p.characters,0);
      host.querySelectorAll('[data-page-number]').forEach(box=>box.checked=chosen.has(Number(box.dataset.pageNumber)));
      if(!fromRange)host.querySelector('#analysisPageRange').value=formatPageRange(selection);
      const error=!selection.length?'请选择需要分析的页面':characters<6?'所选材料没有正文，请先识别或填写文字':selection.length>preview.maxSelectedPages?`最多选择 ${preview.maxSelectedPages} 页，请缩小范围`:characters>preview.maxCharacters?'所选正文过多，请缩小范围':'';
      host.querySelector('#pageSelectionSummary').textContent=`已选 ${selection.length} / ${preview.totalPages} 页 · 约 ${characters.toLocaleString()} 字${error?' · '+error:''}`;
      onReady(!error);
    }catch(error){host.querySelector('#pageSelectionSummary').textContent=error.message;onReady(false);}
  }
  async function upload(){
    const file=getFile();if(!file)return false;
    disposeThumbnails?.();disposeThumbnails=null;pending?.abort();preview=null;onReady(false);
    const controller=new AbortController();pending=controller;
    host.hidden=false;host.innerHTML='<p role="status">正在上传并读取页数，不调用模型…</p>';
    try{
      const body=new FormData();body.append('pptx',file);
      const response=await fetch('/api/material-preview',{method:'POST',body,signal:controller.signal}),data=await response.json();
      if(!response.ok)throw Error(data.error||'材料预览失败');
      if(getFile()!==file||pending!==controller)return false;
      preview=data;selection=data.totalPages<=data.maxSelectedPages?data.pages.map(p=>p.number):[];
      host.innerHTML=`<header><b>选择本次分析页面</b><span>文件共 ${data.totalPages} 页</span></header><label>页码范围<input id="analysisPageRange" placeholder="例如：3, 8, 12-25" autocomplete="off"></label><div class="page-selection-actions"><button type="button" data-select-all>全选</button><button type="button" data-select-none>清空</button><button type="button" data-reupload>更换文件</button><button type="button" data-layout="grid" aria-pressed="true">网格</button><button type="button" data-layout="list" aria-pressed="false">列表</button></div><p id="pageSelectionSummary" aria-live="polite"></p><p data-preview-status role="status"></p><div class="page-selection-list" data-layout="grid">${data.pages.map(p=>`<article class="page-card" data-thumbnail-page="${p.number}"><label class="page-choice"><input type="checkbox" data-page-number="${p.number}" aria-label="选择第 ${p.number} 页"><span class="page-thumbnail">正在等待预览…</span><b>第 ${p.number} 页</b></label><button type="button" data-zoom-page="${p.number}" disabled aria-label="放大第 ${p.number} 页">放大</button></article>`).join('')}</div>`;
      host.querySelectorAll('button[data-layout]').forEach(button=>button.onclick=()=>{host.querySelector('.page-selection-list').dataset.layout=button.dataset.layout;host.querySelectorAll('button[data-layout]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));});
      host.querySelector('#analysisPageRange').oninput=()=>update(true);
      host.querySelector('[data-select-all]').onclick=()=>{selection=data.pages.map(p=>p.number);update();};
      host.querySelector('[data-select-none]').onclick=()=>{selection=[];update();};
      host.querySelector('[data-reupload]').onclick=()=>document.querySelector('#fileInput').click();
      host.querySelector('.page-selection-list').onchange=()=>{selection=[...host.querySelectorAll('[data-page-number]:checked')].map(p=>Number(p.dataset.pageNumber));update();};
      const textPanel=document.createElement('section');textPanel.className='material-text-review';textPanel.innerHTML='<h3>核对本次分析文字</h3><p>仅勾选的页或正文片段会进入分析；可直接修正识别错误。</p>';
      data.pages.forEach(page=>{const detail=document.createElement('details');detail.innerHTML='<summary></summary><textarea rows="7" aria-label="核对正文"></textarea>';detail.querySelector('summary').textContent=(data.sourceUnit==='section'?'正文片段 ':'第 ')+page.number+(data.sourceUnit==='section'?'':' 页');const input=detail.querySelector('textarea');input.value=page.text||'';input.dataset.textPage=page.number;input.oninput=()=>{page.text=input.value;page.characters=input.value.length;update();};textPanel.append(detail);});host.append(textPanel);
      if(['ppt','pptx','pdf','png','jpg','jpeg'].includes(data.sourceFormat)){const ocr=document.createElement('button');ocr.type='button';ocr.textContent='识别所选页面文字（本机，最多20页）';ocr.onclick=async()=>{ocr.disabled=true;ocr.textContent='正在本机识别，请稍候…';try{const response=await fetch('/api/material-preview/'+data.materialId+'/ocr',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pageRange:formatPageRange(selection)})}),result=await response.json();if(!response.ok)throw Error(result.error);for(const p of result.pages){const page=data.pages.find(x=>x.number===p.number),input=host.querySelector('[data-text-page="'+p.number+'"]');page.text=p.text;page.characters=p.text.length;input.value=p.text;input.parentElement.open=true;}update();}catch(e){onError(e.message);}finally{ocr.disabled=false;ocr.textContent='识别所选页面文字（本机，最多20页）';}};textPanel.prepend(ocr);}
      if(data.sourceUnit==='section'){host.querySelector('header span').textContent='文件共 '+data.totalPages+' 个正文片段';host.querySelectorAll('[data-zoom-page]').forEach(b=>b.remove());host.querySelectorAll('.page-choice b').forEach((b,i)=>b.textContent='正文片段 '+(i+1));host.querySelector('header b').textContent='选择正文片段（不是原稿页码）';host.querySelectorAll('.page-thumbnail').forEach((box,i)=>box.textContent=data.pages[i].text.slice(0,300));}
      else if(['png','jpg','jpeg'].includes(data.sourceFormat)){const img=document.createElement('img');img.src='/api/material-preview/'+data.materialId+'/image';img.alt='上传的教材原图';img.style.maxWidth='100%';host.querySelector('.page-thumbnail').replaceChildren(img);const zoom=host.querySelector('[data-zoom-page]');zoom.disabled=false;zoom.onclick=()=>{const dialog=document.createElement('dialog');dialog.style.cssText='max-width:95vw;max-height:95vh;overflow:auto';const close=document.createElement('button');close.textContent='关闭原图';close.onclick=()=>dialog.close();const full=img.cloneNode();full.style.cssText='display:block;max-width:100%;height:auto';dialog.append(close,full);document.body.append(dialog);dialog.onclose=()=>dialog.remove();dialog.showModal();};}
      else disposeThumbnails=createPageThumbnails(host,data.materialId,data.totalPages);
      update();return true;
    }catch(error){if(error.name!=='AbortError'&&pending===controller){host.innerHTML='<p>未完成预览，请重新选择文件。</p>';onError(error.message);}return false;}
    finally{if(pending===controller)pending=null;}
  }
  return {reset,upload,refresh(){if(preview)update(true);},get ready(){return !!preview;},get payload(){if(!preview)throw Error('请先上传并选页');const pages=parsePageRange(host.querySelector('#analysisPageRange').value,preview.totalPages);if(!pages.length)throw Error('请至少选择一页');return {materialId:preview.materialId,pageRange:formatPageRange(pages),editedTexts:Object.fromEntries(preview.pages.filter(p=>pages.includes(p.number)).map(p=>[p.number,p.text]))};}};
}
