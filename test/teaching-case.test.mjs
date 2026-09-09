import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewTargets,currentReview,addCaseReview,addCaseRun,caseReport,buildCaseHtml,updateCaseRun,withdrawCaseRun,restoreCaseRun} from '../public/teaching-case.js';
import {readCaseDraft,writeCaseDraft,compatibleCaseDraft} from '../public/case-drafts.js';
import {duplicateTeachingUnit} from '../public/unit-duplication.js';
import {assessUnitReadiness} from '../public/unit-readiness.js';
import {buildTeachingAlignment,alignmentFromSelections} from '../public/teaching-alignment.js';
const unit=()=>({title:'知识验证',source:{selectedPageNumbers:[201,203]},objectives:[],keyPoints:[{id:'k',title:'示例',logic:'状态变化必须满足条件',evidence:[{quote:'条件成立才执行'}]}]});
test('human review cannot be approved automatically and expires after edits',()=>{
 const u=unit(),t=reviewTargets(u)[0];assert.equal(currentReview(u,t).status,'pending');
 const input={targetId:t.id,fingerprint:t.fingerprint,status:'approved',reviewer:'教师',note:'已核对原文',checks:{facts:true,logic:true,clarity:true}};
 assert.throws(()=>addCaseReview(u,{...input,checks:{}}));addCaseReview(u,input);assert.equal(currentReview(u,t).status,'approved');
 u.keyPoints[0].logic='改变后的解释';assert.equal(currentReview(u,reviewTargets(u)[0]).status,'stale');assert.throws(()=>addCaseReview(u,input),/变化/);
 assert.equal(u.caseReviews.length,1);
});
test('real use records distinguish unknown timings, trials and classroom',()=>{
 const u=unit();const r=addCaseRun(u,{date:'2026-09-08',kind:'trial',observation:'发现术语不一致',preparation:'1',waiting:'',revision:'2'});
 assert.equal(r.total,null);assert.ok(caseReport(u).gaps.some(g=>g.includes('尚无真实课堂')));
 assert.throws(()=>addCaseRun(u,{date:'2026-09-08',kind:'classroom',observation:'观察',waiting:-1}));
 assert.equal(addCaseRun(u,{date:'2026-09-08',kind:'classroom',observation:'学生对边界提出问题',preparation:0,waiting:2,revision:3}).total,5);
});
test('export escapes untrusted content and retains original page references',()=>{
 const u=unit();u.title='<script>alert(1)</script>';const html=buildCaseHtml(u);
 assert.ok(!html.includes('<script>'));assert.ok(html.includes('201、203'));assert.ok(html.includes('尚无记录'));
});
test('negative reviews block readiness and copies cannot inherit case evidence',()=>{
 const u=unit(),t=reviewTargets(u)[0];addCaseReview(u,{targetId:t.id,fingerprint:t.fingerprint,status:'needs-revision',reviewer:'教师',note:'需补充条件'});
 const report=assessUnitReadiness(u);assert.equal(report.ready,false);
 u.caseRuns=[{kind:'classroom',observation:'旧班级观察'}];const copy=duplicateTeachingUnit(u);assert.deepEqual(copy.caseRuns,[]);assert.deepEqual(copy.caseReviews,[]);
});
test('editing a linked activity invalidates prior objective confirmation',()=>{
 const u=unit();u.objectives=['解释状态变化条件'];u.lesson={flow:[{id:'a',phase:'观察',teacherAction:'展示变化',studentAction:'解释条件'}],questions:[]};
 u.teachingAlignment=alignmentFromSelections(u,buildTeachingAlignment(u).rows);assert.equal(buildTeachingAlignment(u).confirmed,1);
 u.lesson.flow[0].teacherAction='改变演示条件';assert.equal(buildTeachingAlignment(u).confirmed,0);
});
test('corrections preserve history and withdrawal excludes classroom evidence',()=>{
 const u=unit(),r=addCaseRun(u,{date:'2026-09-08',kind:'classroom',observation:'原记录'}),expected=JSON.stringify(r);
 const next=updateCaseRun(u,r.id,{date:'2026-09-08',kind:'classroom',observation:'更正记录'},expected);
 assert.equal(next.history[0].observation,'原记录');assert.throws(()=>updateCaseRun(u,r.id,{date:'2026-09-08',kind:'trial',observation:'过期修改'},expected));
 withdrawCaseRun(u,r.id);assert.equal(caseReport(u).runs.length,0);assert.ok(buildCaseHtml(u).includes('尚无记录'));assert.equal(u.caseRuns.length,1);
 restoreCaseRun(u,r.id);assert.equal(caseReport(u).runs.length,1);assert.equal(u.caseRuns[0].history[0].observation,'原记录');
 assert.throws(()=>addCaseRun(u,{date:'2026-02-30',kind:'trial',observation:'日期错误'}));
});
test('case drafts isolate units and invalidate changed review checks',()=>{
 const data=new Map(),storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)},u={...unit(),id:'u1'},t=reviewTargets(u)[0];
 writeCaseDraft(storage,u.id,{fields:{observation:'尚未保存',audience:'草稿'},contextBase:'{}',reviews:{[t.id]:{fingerprint:t.fingerprint,checks:{facts:true}}}});
 const saved=readCaseDraft(storage,u.id);assert.equal(compatibleCaseDraft(saved,u,[t]).fields.observation,'尚未保存');assert.equal(readCaseDraft(storage,'u2'),null);
 u.teachingContext={audience:'新背景'};const restored=compatibleCaseDraft(saved,u,reviewTargets(u));assert.equal(restored.fields.audience,undefined);assert.deepEqual(restored.reviews,{});assert.equal(restored.fields.observation,'尚未保存');
 assert.equal(writeCaseDraft({setItem(){throw Error('quota');}},'u1',{}),false);
});
