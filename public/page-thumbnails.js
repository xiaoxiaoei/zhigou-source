// Render real PDF pages locally, only as cards enter the scroll viewport.
export function createPageThumbnails(host,materialId,totalPages){
  let stopped=false,task,pdf,observer,busy=false,zoomTask;
  const queue=[],urls=[],controller=new AbortController();
  const status=host.querySelector('[data-preview-status]');
  const dialog=document.createElement('dialog');dialog.className='page-zoom';
  dialog.innerHTML='<header><b>页面预览</b><button type="button">关闭</button></header><div class="page-zoom-body"></div>';
  document.body.append(dialog);dialog.querySelector('button').onclick=()=>dialog.close();
  const zoomBody=dialog.querySelector('.page-zoom-body');
  async function zoom(number){
    if(!pdf)return;
    zoomTask?.cancel();dialog.querySelector('b').textContent=`第 ${number} 页`;
    zoomBody.textContent='正在读取…';if(!dialog.open)dialog.showModal();
    try{
      const page=await pdf.getPage(number);if(stopped||!dialog.open)return;
      const base=page.getViewport({scale:1}),canvas=document.createElement('canvas');
      const viewport=page.getViewport({scale:Math.min(1400/base.width,1600/base.height,2)});
      canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      zoomBody.replaceChildren(canvas);zoomTask=page.render({canvasContext:canvas.getContext('2d'),viewport});await zoomTask.promise;
    }catch(error){if(error.name!=='RenderingCancelledException'&&!stopped)zoomBody.textContent='该页暂时无法放大，请重试。';}
  }
  async function drain(){
    if(busy||stopped)return;busy=true;
    while(queue.length&&!stopped){
      const card=queue.shift(),box=card.querySelector('.page-thumbnail');
      try{
        const page=await pdf.getPage(Number(card.dataset.thumbnailPage));if(stopped)break;
        const base=page.getViewport({scale:1}),viewport=page.getViewport({scale:Math.min(360/base.width,400/base.height)}),canvas=document.createElement('canvas');
        canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
        await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.82));canvas.width=canvas.height=1;
        if(stopped)break;if(!blob)throw Error('empty image');
        const url=URL.createObjectURL(blob);urls.push(url);
        const img=document.createElement('img');img.src=url;img.alt=`第 ${card.dataset.thumbnailPage} 页缩略图`;box.replaceChildren(img);
        card.querySelector('[data-zoom-page]').disabled=false;page.cleanup();
      }catch{if(!stopped)box.textContent='此页预览失败';}
    }
    busy=false;
  }
  host.querySelectorAll('[data-zoom-page]').forEach(button=>button.onclick=event=>{event.preventDefault();event.stopPropagation();void zoom(Number(button.dataset.zoomPage));});
  async function start(){
    status.textContent='正在生成页面缩略图，不调用模型…';
    try{
      const lib=await import('/vendor/pdfjs/build/pdf.mjs');lib.GlobalWorkerOptions.workerSrc='/vendor/pdfjs/build/pdf.worker.mjs';
      const response=await fetch(`/api/material-preview/${encodeURIComponent(materialId)}/document.pdf`,{signal:controller.signal});
      if(!response.ok){const error=await response.json();throw Error(error.error||'页面预览失败');}
      const data=new Uint8Array(await response.arrayBuffer());if(stopped)return;
      task=lib.getDocument({data,isEvalSupported:false,cMapUrl:'/vendor/pdfjs/cmaps/',cMapPacked:true,standardFontDataUrl:'/vendor/pdfjs/standard_fonts/',wasmUrl:'/vendor/pdfjs/wasm/'});
      pdf=await task.promise;if(stopped)return;
      if(pdf.numPages!==totalPages)throw Error('转换后的页数与原文件不一致，请另存为 PDF 后上传，以免页码错位');
      status.textContent='点击卡片勾选，点击放大查看原页';
      observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){observer.unobserve(entry.target);queue.push(entry.target);}void drain();},{root:host.querySelector('.page-selection-list'),rootMargin:'150px'});
      host.querySelectorAll('[data-thumbnail-page]').forEach(card=>observer.observe(card));
    }catch(error){if(stopped)return;status.textContent=`缩略图未生成：${error.message}。可重新上传重试。`;host.querySelectorAll('.page-thumbnail').forEach(box=>box.textContent='预览不可用');}
  }
  void start();
  return ()=>{stopped=true;controller.abort();observer?.disconnect();queue.length=0;zoomTask?.cancel();void task?.destroy();urls.forEach(url=>URL.revokeObjectURL(url));dialog.remove();};
}
