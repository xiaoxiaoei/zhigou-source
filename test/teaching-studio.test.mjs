import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDeck } from '../src/analyzer.mjs';
import { runTeachingTask } from '../src/teaching-task.mjs';
import { fixtureClient, fixtureDeck, stages } from '../scripts/testing/fixture-model.mjs';
import { applyLocalResult, fingerprint } from '../public/local-rebuild.js';
import { sanitizeGeneratedSvg, buildFreeformScene } from '../src/freeform-scene.mjs';

test('review-first workflow produces plans without rendering, then renders only the approved plan', async()=>{
  stages.length=0;
  const result=await analyzeDeck(fixtureDeck,{llmClient:fixtureClient,deferMotion:true});
  assert.equal(result.animations.length,0);
  assert.equal(result.motionPlans.length,1);
  assert.ok(!stages.some(s=>s.startsWith('SVG')));
  const plan=result.motionPlans[0];
  const motion=await runTeachingTask({kind:'render',target:plan.point,blueprint:plan.blueprint,source:[]},fixtureClient);
  assert.equal(motion.knowledgePointId,plan.knowledgePointId);
  assert.ok(motion.scene.svgMarkup);
  assert.ok(stages.some(s=>s.startsWith('SVG')));
  const millisecondScene=buildFreeformScene({...plan.blueprint,svgMarkup:motion.scene.svgMarkup,durationMs:9000,phases:[{label:'初态',at:0},{label:'中间',at:3000},{label:'后段',at:6000},{label:'结果',at:7500}]});
  assert.deepEqual(millisecondScene.phases.map(p=>p.at),[0,1/3,2/3,5/6]);
});

test('local apply preserves identity and other content, marks linked assets, rejects concurrent changes',()=>{
  const unit={keyPoints:[{id:'k',title:'旧',logic:'原理',evidence:[{quote:'原句'}]}],resources:[{id:'r',title:'关联实验',keyPointIds:['k']},{id:'other',title:'不相关'}],animations:[],lesson:{questions:[{id:'q',prompt:'旧问题',keyPointIds:['k']}],flow:[]},motionPlans:[{knowledgePointId:'k',status:'draft'}]};
  const pending={kind:'knowledge',index:0,baseline:fingerprint(unit.keyPoints[0]),value:{title:'新',logic:'修订机制'}};
  applyLocalResult(unit,pending);
  assert.equal(unit.keyPoints[0].id,'k');
  assert.deepEqual(unit.keyPoints[0].evidence,[{quote:'原句'}]);
  assert.equal(unit.resources[0].contentReview.status,'needs-review');
  assert.equal(unit.resources[1].contentReview,undefined);
  assert.equal(unit.motionPlans[0].status,'stale');
  assert.throws(()=>applyLocalResult(unit,pending),/已变化/);
  const q=unit.lesson.questions[0];
  applyLocalResult(unit,{kind:'question',index:0,baseline:fingerprint(q),value:{prompt:'新题',answerCue:'答案',misconception:'误解'}});
  assert.equal(unit.lesson.questions[0].id,'q');
  assert.deepEqual(unit.lesson.questions[0].keyPointIds,['k']);
});

test('partial model outputs cannot silently overwrite a knowledge point',async()=>{
  const client={model:'fake',forModel(){return this;},async completeJson(){return {title:'缺字段'};}};
  await assert.rejects(runTeachingTask({kind:'knowledge',target:{},source:[]},client),/缺少必要字段/);
});

test('generated SVG only allows internal image and paint references',()=>{
  assert.equal(sanitizeGeneratedSvg('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/pixel" width="100" height="100"/></svg>'),null);
  assert.equal(sanitizeGeneratedSvg('<svg xmlns="http://www.w3.org/2000/svg"><style>circle{fill:url(https://example.com/paint)}</style><circle r="20"/></svg>'),null);
});
