export function setupOutlineUpload(){
  const dialog=document.querySelector('#courseBatchDialog'), host=dialog.querySelector('.course-batch-input');
  const panel=document.createElement('section');
  panel.innerHTML='<label>上传课程大纲<input type="file" accept=".doc,.docx,.pdf,.ppt,.pptx" data-outline-file></label><button type="button" class="button outline" data-outline-extract disabled>识别章节结构</button><p role="status" data-outline-status>文件仅识别章节，不生成单元内容。识别会调用一次当前配置的模型。</p>';
  host.prepend(panel);
  const scope=document.createElement('label');scope.innerHTML='拆分粒度<select data-outline-granularity><option value="auto">自动：有节按节，无节按章</option><option value="chapter">按章建立</option><option value="section">按节建立（无节则保留章）</option></select>';panel.prepend(scope);
  const file=panel.querySelector('input'),button=panel.querySelector('button'),status=panel.querySelector('[role=status]'),text=dialog.querySelector('#courseBatchText');
  let busy=false, controller;
  file.onchange=()=>{button.disabled=!file.files.length;status.textContent='已选文件，点击识别后可修改单元标题。';};
  dialog.addEventListener('close',()=>{controller?.abort();file.value='';button.disabled=true;});
  button.onclick=async()=>{
    if(busy||!file.files[0])return;
    const selected=file.files[0];
    if(selected.size>50*1024*1024){status.textContent='文件不能超过 50 MB';return;}
    busy=true;controller=new AbortController();button.disabled=true;file.disabled=true;
    const confirm=dialog.querySelector('#confirmCourseBatch'),preview=dialog.querySelector('#previewCourseBatch');
    confirm.disabled=true;preview.disabled=true;text.disabled=true;
    try{
      status.textContent='正在读取大纲文件…';const body=new FormData();body.append('pptx',selected);
      const response=await fetch('/api/material-preview',{method:'POST',body,signal:controller.signal}),data=await response.json();if(!response.ok)throw Error(data.error||'文件读取失败');
      status.textContent='正在识别章节结构，不生成知识点和资源…';
      const result=await fetch('/api/course-outline',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:data.pages.map(p=>p.text).join('\n'),granularity:scope.querySelector('select').value}),signal:controller.signal}),outline=await result.json();if(!result.ok)throw Error(outline.error||'结构识别失败');
      text.value=outline.units.map(u=>u.title).join('\n');text.dispatchEvent(new Event('input',{bubbles:true}));text.dataset.outlineUnits=JSON.stringify(outline.units);preview.disabled=false;preview.click();
      dialog.querySelectorAll('[data-batch-row]').forEach((box,i)=>{const u=outline.units[i];if(!u)return;const note=document.createElement('small');note.textContent=(u.level==='section'?'节':u.level==='chapter'?'章':'主题')+(u.parentTitle?' · '+u.parentTitle:'');note.style.gridColumn='2 / -1';box.parentElement.append(note);});
      status.textContent=`已识别 ${outline.units.length} 个单元；核对右侧标题，再点击创建。单元内容保持空白。`;
    }catch(error){if(error.name!=='AbortError')status.textContent=error.message;}
    finally{busy=false;file.disabled=false;button.disabled=!file.files.length;preview.disabled=false;text.disabled=false;}
  };
}
