import fs from 'node:fs/promises';
import path from 'node:path';
import {createLlmClientFromEnv} from './llm-client.mjs';
const fields={baseUrl:'LLM_BASE_URL',model:'LLM_MODEL',protocol:'LLM_PROTOCOL',extraction:'LLM_FAST_MODEL',reasoning:'LLM_REASONING_MODEL',planning:'LLM_VISUAL_PLANNER_MODEL',rendering:'LLM_RENDER_MODEL',timeout:'LLM_TIMEOUT_MS',concurrency:'LLM_WORKFLOW_CONCURRENCY'};
export function publicSettings(env=process.env){return {...Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,env[v]||''])),hasKey:!!env.LLM_API_KEY};}
export function validateSettings(body,current=process.env){
  const next={};
  for(const [key,name]of Object.entries(fields))if(body[key]!==undefined)next[name]=String(body[key]).trim().slice(0,2000);
  if(body.apiKey)next.LLM_API_KEY=String(body.apiKey).trim();
  const url=new URL(next.LLM_BASE_URL||current.LLM_BASE_URL);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error('API 地址须为不含密钥、查询参数的 HTTP(S) 地址');
  if(!['openai','ollama'].includes(next.LLM_PROTOCOL||current.LLM_PROTOCOL||'openai'))throw Error('请选择支持的接口协议');
  for(const [key,min,max]of [['LLM_TIMEOUT_MS',10000,600000],['LLM_WORKFLOW_CONCURRENCY',1,4]])if(next[key]&&(!Number.isInteger(Number(next[key]))||Number(next[key])<min||Number(next[key])>max))throw Error(key==='LLM_TIMEOUT_MS'?'超时应在10000至600000毫秒之间':'并发数应为1至4');
  if((next.LLM_PROTOCOL||current.LLM_PROTOCOL)==='ollama'&&!next.LLM_API_KEY&&!current.LLM_API_KEY)next.LLM_API_KEY='ollama';
  return next;
}
export async function loadSettings(file){try{const saved=JSON.parse(await fs.readFile(file,'utf8'));Object.assign(process.env,validateSettings(Object.fromEntries([...Object.entries(fields).map(([key,name])=>[key,saved[name]]),['apiKey',saved.LLM_API_KEY]])));}catch(e){if(e.code!=='ENOENT')console.warn('本机模型设置未载入，请在设置中重新保存。');}}
export function installSettings(app,{file,onChange,isBusy}){
  const local=(req,res,next)=>{
    const ip=req.socket.remoteAddress||'',host=req.hostname;
    if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(ip)||!['localhost','127.0.0.1','::1','[::1]'].includes(host))return res.status(403).json({error:'模型设置仅允许从本机访问'});
    if(req.method!=='GET'&&(!req.is('application/json')||req.headers.origin&&req.headers.origin!==`${req.protocol}://${req.get('host')}`))return res.status(403).json({error:'不允许跨站修改设置'});
    next();
  };
  app.get('/api/settings',local,(_req,res)=>res.set('Cache-Control','no-store').json(publicSettings()));
  app.post('/api/settings',local,async(req,res)=>{
    if(isBusy())return res.status(409).json({error:'请等待正在生成的任务结束，再修改模型配置'});
    try{const next={...Object.fromEntries(Object.values(fields).map(k=>[k,process.env[k]||''])),LLM_API_KEY:process.env.LLM_API_KEY||'',...validateSettings(req.body)};
      await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file+'.tmp',JSON.stringify(next),{mode:0o600});await fs.chmod(file+'.tmp',0o600);await fs.rename(file+'.tmp',file);
      Object.assign(process.env,next);onChange(createLlmClientFromEnv());res.json({ok:true,...publicSettings()});
    }catch{res.status(400).json({error:'保存失败，请检查地址、协议、模型名、超时（10–600秒）及并发（1–4）'});}
  });
  app.post('/api/settings/test',local,async(_req,res)=>{
    try{const client=createLlmClientFromEnv();await client.completeJson({stage:'连接测试',prompt:'只输出 {"ok":true}'});res.json({ok:true,runtime:client.runtime,model:client.model});}
    catch{res.status(502).json({error:'连接未通过。请检查地址、密钥、模型权限和网络；不会显示密钥或服务端原始响应。'});}
  });
}
