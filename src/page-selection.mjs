import {parsePageRange} from '../public/page-range.js';
export function selectDeckPages(deck,range,{maxPages=200,maxCharacters=250000,allowEmpty=false}={}){
  const numbers=parsePageRange(range,deck.slideCount);
  if(!numbers.length)throw Object.assign(Error('请至少选择一页'),{status:400});
  if(numbers.length>maxPages)throw Object.assign(Error(`本次选择 ${numbers.length} 页，超过 ${maxPages} 页上限，请缩小范围`),{status:413});
  const wanted=new Set(numbers),slides=deck.slides.filter(s=>wanted.has(s.number));
  if(slides.length!==numbers.length)throw Object.assign(Error('部分页面不存在，请重新选择'),{status:400});
  const count=slides.reduce((n,s)=>n+(s.text||'').length+(s.notes||'').length,0);
  if(count>maxCharacters)throw Object.assign(Error(`所选页面正文超过 ${maxCharacters.toLocaleString()} 字，请缩小范围`),{status:413});
  if(!allowEmpty&&!slides.some(s=>(s.text||'').replace(/第\s*\d+\s*页/g,'').trim().length>5))throw Object.assign(Error('所选页面没有可分析的正文，可能需要 OCR 文字识别'),{status:422});
  return {...deck,title:slides[0].title||deck.title,slides,slideCount:slides.length,originalSlideCount:deck.slideCount,selectedPageNumbers:numbers,importWarnings:[...(deck.importWarnings||[]),...(slides.some(s=>!s.text?.trim())?['部分所选页面没有可提取文字，请核对扫描图或空白页。']:[])]};
}
