import test from 'node:test';
import assert from 'node:assert/strict';
import {archivePendingResult,resultConflict} from '../public/studio-drafts.js';
import {fingerprint} from '../public/local-rebuild.js';
import {assessMotionQuality,getMotionQualityState} from '../public/motion-quality.js';

test('archiving frees the pending slot, retains content and deduplicates by job',()=>{
  const pending={jobId:'j1',kind:'render',value:{title:'保留的动效'}};
  const unit={pendingLocalResult:pending};
  assert.equal(archivePendingResult(unit),true);assert.equal(unit.pendingLocalResult,null);
  assert.equal(unit.motionDraftArchive[0].value.title,'保留的动效');
  unit.pendingLocalResult=pending;archivePendingResult(unit);assert.equal(unit.motionDraftArchive.length,1);
  assert.equal(archivePendingResult(unit),false);
});
test('stale drafts identify source, target and plan conflicts before applying',()=>{
  const point={id:'k',title:'初始'},blueprint={title:'方案'},source=[];
  const unit={keyPoints:[point],motionPlans:[{blueprint}]};
  const pending={kind:'render',planIndex:0,baseline:fingerprint(point),sourceBaseline:fingerprint(source),planBaseline:fingerprint(blueprint),value:{knowledgePointId:'k'}};
  assert.equal(resultConflict(unit,pending,source),'');
  assert.match(resultConflict(unit,pending,[{text:'新增材料'}]),/材料/);
  unit.motionPlans[0].blueprint={title:'修改方案'};assert.match(resultConflict(unit,pending,source),/方案/);
  unit.keyPoints=[];assert.match(resultConflict(unit,pending,source),/删除/);
});
test('unchecked layout is pending, not passed or a repair warning',()=>{
  const assessment=assessMotionQuality({});
  const layout=assessment.checks.find(c=>c.id==='layout');
  assert.equal(layout.pending,true);assert.equal(layout.pass,null);
  assert.ok(!assessment.warnings.some(c=>c.id==='layout'));
  assert.notEqual(getMotionQualityState({qualityReview:{status:'approved'}}).id,'approved');
});
