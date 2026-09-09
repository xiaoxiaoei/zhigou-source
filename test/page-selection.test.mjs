import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePageRange,formatPageRange} from '../public/page-range.js';
import {selectDeckPages} from '../src/page-selection.mjs';
import {analyzeDeck} from '../src/analyzer.mjs';
import {fixtureDeck,fixtureClient} from '../scripts/testing/fixture-model.mjs';
test('page ranges support discrete pages and preserve original ordering',()=>{
  assert.deepEqual(parsePageRange('12–15，3、8, 12',250),[3,8,12,13,14,15]);
  assert.equal(formatPageRange([3,8,12,13,14,15]),'3, 8, 12-15');
  for(const value of ['0','2-1','251','abc','1-'])assert.throws(()=>parsePageRange(value,250));
});
test('large documents are limited by selected pages and text, not total pages',()=>{
  const deck={slideCount:300,title:'全集',slides:Array.from({length:300},(_,i)=>({number:i+1,title:`原页 ${i+1}`,text:`这是第 ${i+1} 页的材料正文`}))};
  const selected=selectDeckPages(deck,'201,250-251');
  assert.equal(selected.slideCount,3);assert.equal(selected.originalSlideCount,300);
  assert.deepEqual(selected.slides.map(s=>s.number),[201,250,251]);
  assert.ok(!JSON.stringify(selected.slides).includes('这是第 1 页'));
  assert.throws(()=>selectDeckPages(deck,'1-201'),/超过/);
  assert.throws(()=>selectDeckPages(deck,''),/至少/);
  assert.throws(()=>selectDeckPages(deck,'250',{maxCharacters:2}),/正文/);
});
test('semantic workflow accepts original high page numbers after selection',async()=>{
  const remap=value=>Array.isArray(value)?value.map(remap):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,k==='slideNumber'?v+200:k==='slideNumbers'?v.map(n=>n+200):remap(v)])):value;
  const client={...fixtureClient,forModel(){return this;},async completeJson(input){return remap(await fixtureClient.completeJson(input));}};
  const deck={...fixtureDeck,slides:fixtureDeck.slides.map(s=>({...s,number:s.number+200})),originalSlideCount:300};
  const result=await analyzeDeck(deck,{llmClient:client,deferMotion:true});
  assert.ok(result.keyPoints.length);assert.ok(result.keyPoints.every(p=>p.slideNumbers.every(n=>n>200)));
});
