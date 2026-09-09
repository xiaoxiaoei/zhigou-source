import renderMathInElement from '/vendor/katex/contrib/auto-render.mjs';
import {normalizeMathSource} from './math-source.js';
const excluded='script,style,textarea,input,pre,code,option,svg,.katex,.katex-display,[contenteditable="true"]';
const options={delimiters:[{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false},{left:'\\(',right:'\\)',display:false},{left:'\\[',right:'\\]',display:true}],ignoredTags:['script','style','textarea','pre','code','option','svg'],ignoredClasses:['katex','katex-display'],throwOnError:false,trust:false,maxExpand:1000,preProcess:normalizeMathSource};
const pending=new Set();let scheduled=false;
function render(root){if(!(root instanceof Element)||root.closest(excluded))return;renderMathInElement(root,options);}
const observer=new MutationObserver(records=>{
  for(const record of records){if(record.target.parentElement?.closest(excluded))continue;
    if(record.type==='characterData'){if(/\$|\\[([]/.test(record.target.textContent||''))pending.add(record.target.parentElement);}
    else for(const node of record.addedNodes){const el=node.nodeType===1?node:node.parentElement;if(el&&!el.closest(excluded)&&/\$|\\[([]/.test(node.textContent||''))pending.add(el);}
  }
  if(pending.size&&!scheduled){scheduled=true;requestAnimationFrame(()=>{observer.disconnect();for(const root of pending)if(root.isConnected)render(root);pending.clear();scheduled=false;observe();});}
});
function observe(){observer.observe(document.body,{childList:true,subtree:true,characterData:true});}
render(document.body);observe();
