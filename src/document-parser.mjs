import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Worker } from 'node:worker_threads';
import JSZip from 'jszip';
import { parsePptx } from './pptx-parser.mjs';

const execute=promisify(execFile);
export const DOCUMENT_FORMATS=['.pptx','.ppt','.docx','.doc','.pdf','.png','.jpg','.jpeg'];
export function inputError(message,code='INVALID_DOCUMENT',status=422){return Object.assign(new Error(message),{code,status});}

async function parseWord(buffer,filename){
  const zip=await JSZip.loadAsync(buffer),entry=zip.file('word/document.xml');
  if(!entry)throw inputError('Word 文件缺少正文，可能已损坏。');
  let expanded=0;for(const file of Object.values(zip.files)){expanded+=file._data?.uncompressedSize||0;if(expanded>100*1024*1024)throw inputError('文档解压后过大，请拆分后上传。','EXPANDED_DOCUMENT_TOO_LARGE',413);}
  const decode=text=>text.replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n)=>{const v=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return v<=0x10ffff?String.fromCodePoint(v):'';}).replace(/&(lt|gt|quot|apos|amp);/g,(_,n)=>({lt:'<',gt:'>',quot:'"',apos:"'",amp:'&'}[n]));
  const texts=[];
  for(const name of ['word/document.xml','word/footnotes.xml','word/endnotes.xml']){
    if(!zip.file(name))continue;
    const xml=(await zip.file(name).async('string')).replace(/<w:del\b[\s\S]*?<\/w:del>/g,'');
    let content='';for(const token of xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>|<\/w:(?:p|tc|tr)>/g))content+=token[1]!==undefined?decode(token[1]):token[0].startsWith('</w:tc')?' | ':token[0].startsWith('<w:tab')?'\t':'\n';
    texts.push(content.replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim());
  }
  const lines=texts.join('\n\n').split('\n').map(s=>s.trim()).filter(Boolean),groups=[];let group='';
  for(const line of lines){for(let offset=0;offset<line.length;offset+=3500){const part=line.slice(offset,offset+3500);if(group.length+part.length>4000){groups.push(group);group='';}group+=(group?'\n':'')+part;}}
  if(group)groups.push(group);
  return {filename,title:path.basename(filename,path.extname(filename)),sourceUnit:'section',slideCount:groups.length,slides:groups.map((text,index)=>({number:index+1,title:`正文片段 ${index+1}`,text,paragraphs:text.split('\n').map(text=>({text,level:0,bullet:false})),notes:'',tableRows:[],media:{images:0,charts:0,tables:0,diagrams:0}})),importWarnings:['Word 按正文片段定位，片段序号不是原稿页码；图片内文字和复杂公式需另行核对。']};
}

export async function officeBinary(){
  const candidates=[process.env.SOFFICE_BINARY,'/Applications/LibreOffice.app/Contents/MacOS/soffice','/usr/bin/libreoffice','/usr/bin/soffice'].filter(Boolean);
  for(const candidate of candidates){try{await fs.access(candidate);return candidate;}catch{}}
  return null;
}

export async function convertOffice(buffer,extension,format){
  const binary=await officeBinary();
  if(!binary)throw inputError('本地 Office 转换组件不可用，请配置 LibreOffice 后重试。','OFFICE_CONVERTER_UNAVAILABLE',503);
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'teaching-import-'));
  try{
    const profile=path.join(directory,'profile');await fs.mkdir(path.join(profile,'user'),{recursive:true});
    await fs.writeFile(path.join(profile,'user','registrymodifications.xcu'),`<?xml version="1.0" encoding="UTF-8"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item><item oor:path="/org.openoffice.Office.Writer/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>0</value></prop></item></oor:items>`);
    const input=path.join(directory,`input${extension}`);await fs.writeFile(input,buffer);
    const args=[`-env:UserInstallation=${pathToFileURL(profile).href}`,'--headless','--nologo','--nodefault','--norestore','--convert-to',format,'--outdir',directory,input];
    // No shell interpolation or user filenames; separate profile disables macros.
    const sandbox=process.platform==='darwin'?'/usr/bin/sandbox-exec':null;
    const env={...process.env};
    // Bundled headless macOS builds need their fontconfig location explicitly.
    const fontConfig=path.resolve(path.dirname(binary),'../Resources/fontconfig/fonts.conf');
    if(process.platform==='darwin'&&!env.FONTCONFIG_FILE){try{await fs.access(fontConfig);env.FONTCONFIG_FILE=fontConfig;env.FONTCONFIG_PATH=path.dirname(fontConfig);}catch{}}
    await execute(sandbox||binary,sandbox?['-p','(version 1)(allow default)(deny network*)',binary,...args]:args,{env,timeout:60000,killSignal:'SIGKILL',maxBuffer:1024*1024});
    const output=path.join(directory,`input.${format.split(':')[0]}`);
    const info=await fs.stat(output);
    if(info.size>100*1024*1024)throw inputError('转换后的文档过大，请拆分文件后上传。','CONVERTED_DOCUMENT_TOO_LARGE',413);
    return await fs.readFile(output);
  }catch(error){
    if(error.code==='CONVERTED_DOCUMENT_TOO_LARGE')throw error;
    throw inputError(error.killed?'文档转换超时，请拆分文件或另存为新版格式后重试。':'无法读取此 Office 文件，可能已加密、损坏或格式不匹配；请在 Office 中另存后重试。','OFFICE_CONVERSION_FAILED');
  }finally{await fs.rm(directory,{recursive:true,force:true});}
}

function parsePdf(buffer,filename,limits){
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./pdf-import-worker.mjs',import.meta.url),{workerData:{buffer,filename,limits},resourceLimits:{maxOldGenerationSizeMb:256}});
    let settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);void worker.terminate();error?reject(error):resolve(value);};
    const timer=setTimeout(()=>finish(inputError('PDF 解析超时，请拆分文件后重试。','PDF_PARSE_TIMEOUT')),45000);
    worker.once('message',message=>finish(message.error?inputError(message.error.message,message.error.code,message.error.status):null,message.deck));
    worker.once('error',()=>finish(inputError('PDF 解析未完成，请检查文件是否损坏或内容过于复杂。','PDF_PARSE_FAILED')));
    worker.once('exit',()=>{if(!settled)finish(inputError('PDF 解析已停止，请拆分文件后重试。','PDF_PARSE_FAILED'));});
  });
}

export async function parseTeachingDocument(buffer,filename,{maxPages=200,maxCharacters=250000,allowEmpty=false}={}){
  const extension=path.extname(filename).toLowerCase();
  if(!DOCUMENT_FORMATS.includes(extension))throw inputError('请选择 PPT、PPTX、DOC、DOCX 或 PDF 文件。','UNSUPPORTED_FORMAT',400);
  if(buffer.length>50*1024*1024)throw inputError('文件超过 50 MB 上限。','FILE_TOO_LARGE',413);
  const ole=buffer.subarray(0,8).toString('hex')==='d0cf11e0a1b11ae1';
  const zip=buffer.subarray(0,2).toString()==='PK';
  if((['.doc','.ppt'].includes(extension)&&!ole)||(['.pptx','.docx'].includes(extension)&&!zip)||(extension==='.pdf'&&!buffer.subarray(0,1024).includes(Buffer.from('%PDF-'))))throw inputError('文件内容与扩展名不匹配，请用 Office 另存为对应格式，不要直接修改文件后缀。');
  if(zip){
    let archive;try{archive=await JSZip.loadAsync(buffer);}catch{throw inputError('Office 文件已损坏或不完整，请重新导出后上传。');}
    const entries=Object.values(archive.files);
    if(entries.length>10000||entries.reduce((sum,file)=>sum+(file._data?.uncompressedSize||0),0)>100*1024*1024)throw inputError('材料解压后过大，请拆分后上传。','EXPANDED_DOCUMENT_TOO_LARGE',413);
    if(extension==='.pptx'&&!entries.some(file=>/^ppt\/slides\/slide\d+\.xml$/.test(file.name)))throw inputError('文件中没有 PowerPoint 幻灯片，请检查格式。');
  }
  let deck;
  if(['.png','.jpg','.jpeg'].includes(extension)){
    const png=buffer.subarray(0,8).toString('hex')==='89504e470d0a1a0a',jpg=buffer[0]===255&&buffer[1]===216;
    if(!png&&!jpg)throw inputError('图片格式不正确');
    deck={sourceMode:'image',sourceUnit:'page',title:path.basename(filename,extension),slideCount:1,slides:[{number:1,title:'教材图片',text:'',paragraphs:[],notes:''}],importWarnings:['图片文字需要识别并核对后才能分析']};
  }else if(extension==='.pptx'||extension==='.ppt'){
    const data=extension==='.ppt'?await convertOffice(buffer,extension,'pptx:Impress MS PowerPoint 2007 XML'):buffer;
    deck=await parsePptx(data,filename);deck.sourceMode='ppt';
  }else if(extension==='.pdf'){
    deck=await parsePdf(buffer,filename,{maxPages,maxCharacters,allowEmpty});deck.sourceMode='pdf';
  }else{
    const data=extension==='.doc'?await convertOffice(buffer,extension,'docx:Office Open XML Text'):buffer;
    deck=await parseWord(data,filename);deck.sourceMode='word';
  }
  if(deck.slideCount>maxPages)throw inputError(`材料共 ${deck.slideCount} 页，超过 ${maxPages} 页分析上限`,'TOO_MANY_SLIDES',413);
  if(deck.slides.reduce((sum,s)=>sum+(s.text||'').length,0)>maxCharacters)throw inputError(`材料正文超过 ${maxCharacters.toLocaleString()} 字上限，请拆分后上传。`,'TEXT_TOO_LARGE',413);
  if(!allowEmpty&&!deck.slides.some(s=>(s.text||'').replace(/第\s*\d+\s*页/g,'').trim().length>5))throw inputError('未能提取到可分析的正文。若是扫描件或图片课件，请先进行 OCR 文字识别。','NO_EXTRACTABLE_TEXT');
  return {...deck,filename,sourceFormat:extension.slice(1)};
}
