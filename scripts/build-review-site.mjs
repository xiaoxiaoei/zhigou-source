import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'docs');
await fs.mkdir(out,{recursive:true});
await fs.cp(path.join(root,'public'),out,{recursive:true});
for(const [source,target] of [['@phosphor-icons/web/src','phosphor'],['katex/dist','katex']]){
  await fs.cp(path.join(root,'node_modules',source),path.join(out,'vendor',target),{recursive:true});
}
async function rewrite(dir){
  for(const entry of await fs.readdir(dir,{withFileTypes:true})){
    const file=path.join(dir,entry.name);
    if(entry.isDirectory()){await rewrite(file);continue;}
    if(!/\.(?:js|mjs|html|css)$/.test(file))continue;
    let text=await fs.readFile(file,'utf8');
    // GitHub project sites live under /repository/, not the domain root.
    text=text.replace(/(["'`])\/(?!\/|api\/)(?=[a-zA-Z][\w./-]*\.(?:css|js|mjs|woff2?|ttf|svg|png|html))/g,'$1./');
    await fs.writeFile(file,text);
  }
}
await rewrite(out);
let app=await fs.readFile(path.join(out,'app.js'),'utf8');
const seed=`
// Public review uses only the synthetic built-in example, never local user data.
if(!localStorage.getItem('zhigou-review-seeded-v1')){
  const example=structuredClone(demoUnit);
  example.id='review-sync';example.isDemo=false;example.course='操作系统原理';
  example.status='展示示例';example.updated='预置示例';
  example.lesson.flow.forEach((a,i)=>a.keyPointIds=[['kp-demo-1'],['kp-demo-1'],['kp-demo-2'],['kp-demo-3'],['kp-demo-4']][i]);
  autoArrangeTimeline(example);
  localStorage.setItem(storeKey,JSON.stringify([example]));
  localStorage.setItem(courseStoreKey,JSON.stringify([{id:'review-os',name:'操作系统原理',description:'教学功能展示示例，非真实课堂成效记录。'}]));
  localStorage.setItem('zhigou-review-seeded-v1','1');
}
`;
app=app.replace('const baseUnits=[];',seed+'\nconst baseUnits=[];');
app=app.replace("import {setupModelSettings} from './model-settings.js';",'');
app=app.replace('queueMicrotask(()=>setupModelSettings(checkModel));','');
await fs.writeFile(path.join(out,'app.js'),app);
await fs.rm(path.join(out,'model-settings.js'));
let html=await fs.readFile(path.join(out,'index.html'),'utf8');
html=html.replace('</head>',`<meta name="robots" content="noindex,nofollow"><meta http-equiv="Content-Security-Policy" content="default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' data: blob:; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'none'"><link rel="stylesheet" href="./review-mode.css"><script src="./review-mode.js"></script></head>`);
await fs.writeFile(path.join(out,'index.html'),html);
for(const name of ['review-mode.js','review-mode.css'])await fs.copyFile(path.join(root,'scripts',name),path.join(out,name));
await fs.writeFile(path.join(out,'.nojekyll'),'');
console.log('Built review site: docs/ (no server, no credentials, no live generation)');
