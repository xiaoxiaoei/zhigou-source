import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createMotionDraft,publicMotionDraft,bestMotionDraft} from '../src/motion-draft.mjs';
import {repairExplicitConnectors} from '../src/connector-repair.mjs';
import {renderApprovedMotion} from '../src/semantic-workflow.mjs';
import {fixtureClient} from '../scripts/testing/fixture-model.mjs';
import {AnalysisJobStore} from '../src/job-store.mjs';

const blueprint=await fixtureClient.completeJson({stage:'动效视觉蓝图',prompt:''});
const valid=(await fixtureClient.completeJson({stage:'SVG 动效渲染',prompt:''})).svgMarkup;
const point={id:'k1',title:'温度与运动',slideNumbers:[1],evidence:[],visualDecision:{reason:'测试'}};
test('shape counts do not block scenes; structural failures remain blockers',()=>{
  const raw={...blueprint,svgMarkup:valid};
  const d=createMotionDraft(raw,{},'fixture',1);
  assert.ok(d.scene);assert.equal(d.quality.blockers.length,0);
  const unsafe=createMotionDraft({...raw,svgMarkup:valid.replace('</svg>','<script>alert(1)</script></svg>')},{},'fixture',2);
  assert.equal(unsafe.scene,null);assert.ok(unsafe.quality.blockers.length);
  assert.equal(publicMotionDraft(unsafe).raw,undefined);
  assert.equal(bestMotionDraft([d,unsafe]).id,d.id);
});
test('failed automatic repair retains the first draft and checkpoints before retry',async()=>{
  let count=0,saved=false;
  const client={model:'fixture',async completeJson(){count++;if(count===2){assert.ok(saved);throw Error('timeout');}return {svgMarkup:valid.replaceAll('<animate ','<unused ')};}};
  // Missing explicit animation creates a warning; duplicate ids force a retry.
  client.completeJson=async()=>{count++;if(count===2){assert.ok(saved);throw Error('timeout');}return {svgMarkup:valid.replace('</svg>','<g id="heat"/></svg>')};};
  const result=await renderApprovedMotion(point,blueprint,client,client,0,1,async p=>{if(p.motionDraft){assert.ok(p.motionDraft.raw);saved=true;}});
  assert.equal(count,2);assert.ok(result.scene);assert.equal(result.generationDrafts.length,1);
  assert.ok(result.generationQuality.blockers.length);assert.ok(result.generationQuality.warnings.some(w=>w.includes('自动修复未完成')));
});
test('worse unsafe repair cannot replace the safe original',async()=>{
  let count=0;
  const client={model:'fixture',async completeJson(){return {svgMarkup:++count===1?valid.replace('</svg>','<g id="heat"/></svg>'):'<svg><script>alert(1)</script></svg>'};}};
  const result=await renderApprovedMotion(point,blueprint,client,client);
  assert.equal(count,2);assert.equal(result.generationDrafts.length,2);assert.ok(result.scene);
  assert.equal(result.selectedDraftId,result.generationDrafts[0].id);
  assert.equal(result.generationDrafts[1].scene,null);
  assert.ok(result.generationDrafts.every(d=>!('raw' in d)));
});
test('explicit center lines are trimmed, ambiguous and transformed geometry untouched',()=>{
  const svg='<svg><rect id="a" x="0" y="0" width="100" height="80"/><rect id="b" x="300" y="0" width="100" height="80"/><line id="edge" data-from="a" data-to="b" x1="50" y1="40" x2="350" y2="40"/></svg>';
  const fixed=repairExplicitConnectors(svg);assert.equal(fixed.fixes.length,1);assert.match(fixed.svg,/x1="114.00"/);assert.match(fixed.svg,/x2="286.00"/);
  assert.equal(repairExplicitConnectors(svg.replace('data-from="a"','')).fixes.length,0);
  assert.equal(repairExplicitConnectors(svg.replace('<svg>','<svg transform="translate(10)">')).svg,svg.replace('<svg>','<svg transform="translate(10)">'));
});
test('ordered durable writes preserve latest draft and restart returns recoverable result',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'motion-draft-test-'));
  const store=new AnalysisJobStore({directory});const job={id:'draft-test-123',state:'running',createdAt:new Date().toISOString(),events:[]};
  const first=store.save(job);job.partialResult={value:{scene:{title:'已保存'}}};const second=store.save(job);
  await Promise.all([first,second]);
  const restored=await new AnalysisJobStore({directory}).init();assert.equal(restored[0].state,'failed');assert.equal(restored[0].partialResult.value.scene.title,'已保存');
  await fs.rm(directory,{recursive:true});
});
