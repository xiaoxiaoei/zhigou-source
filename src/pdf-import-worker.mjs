import { parentPort,workerData } from 'node:worker_threads';
import path from 'node:path';
import { createRequire } from 'node:module';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

let task;
try{
  const {buffer,filename,limits}=workerData;
  const root=path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
  task=getDocument({data:new Uint8Array(buffer),cMapUrl:path.join(root,'cmaps')+path.sep,cMapPacked:true,standardFontDataUrl:path.join(root,'standard_fonts')+path.sep,isEvalSupported:false,useSystemFonts:false,disableFontFace:true,verbosity:0});
  const pdf=await task.promise;
  if(pdf.numPages>limits.maxPages)throw Object.assign(Error(`材料共 ${pdf.numPages} 页，超过 ${limits.maxPages} 页分析上限`),{code:'TOO_MANY_SLIDES',status:413});
  const slides=[],emptyPages=[];let characters=0;
  for(let number=1;number<=pdf.numPages;number++){
    const page=await pdf.getPage(number),content=await page.getTextContent();
    let text='',lastY=null,lastEnd=null;
    for(const item of content.items){if(typeof item.str!=='string')continue;const y=item.transform?.[5],x=item.transform?.[4];if(lastY!==null&&Math.abs(y-lastY)>3)text+='\n';else if(lastEnd!==null&&x-lastEnd>2&&text&&!/\s$/.test(text))text+=' ';text+=item.str;if(item.hasEOL)text+='\n';lastY=y;lastEnd=x+item.width;}
    text=text.replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();characters+=text.length;
    if(characters>limits.maxCharacters)throw Object.assign(Error(`材料正文超过 ${limits.maxCharacters.toLocaleString()} 字上限，请拆分后上传。`),{code:'TEXT_TOO_LARGE',status:413});
    if(!text)emptyPages.push(number);
    const lines=text.split('\n').filter(Boolean);
    slides.push({number,title:lines[0]?.slice(0,80)||`第 ${number} 页`,text,paragraphs:lines.map(text=>({text,level:0,bullet:false})),notes:'',tableRows:[],media:{images:0,charts:0,tables:0,diagrams:0}});
    page.cleanup();
  }
  if(characters<6&&!limits.allowEmpty)throw Object.assign(Error('PDF 没有可提取的正文，可能是扫描件。请先进行 OCR 文字识别后再上传。'),{code:'NO_EXTRACTABLE_TEXT',status:422});
  parentPort.postMessage({deck:{filename,title:path.basename(filename,path.extname(filename)),slides,slideCount:pdf.numPages,importWarnings:emptyPages.length?[`第 ${emptyPages.join('、')} 页未提取到文字，可能为空白页或扫描图，请核对材料。`]:[]}});
}catch(error){parentPort.postMessage({error:{message:error.name==='PasswordException'?'PDF 已加密，请先解密后上传。':error.code?error.message:'PDF 无法解析，请检查文件是否损坏或加密。',code:error.code||'INVALID_PDF',status:error.status||422}});}
finally{await task?.destroy();}
