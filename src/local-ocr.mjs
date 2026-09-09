import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile);
export async function recognizePages(buffer,extension,pages){
  if(process.platform!=='darwin')throw Object.assign(Error('当前服务器未配置本机OCR，请粘贴识别文字后分析'),{status:503});
  if(!pages.length||pages.length>20)throw Object.assign(Error('每次识别请选择1至20页'),{status:400});
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'zhigou-ocr-'));
  try{const input=path.join(dir,'input'+extension);await fs.writeFile(input,buffer);
    const {stdout}=await exec('/usr/bin/swift',[fileURLToPath(new URL('../scripts/recognize-pages.swift',import.meta.url)),input,pages.join(',')],{timeout:120000,maxBuffer:4*1024*1024});
    return JSON.parse(stdout);
  }catch(error){if(error.status)throw error;throw Object.assign(Error('本机文字识别未完成，请检查文件或减少页数后重试'),{status:422});}
  finally{await fs.rm(dir,{recursive:true,force:true});}
}
