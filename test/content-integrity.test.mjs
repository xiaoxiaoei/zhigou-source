import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLessonPlan } from '../src/semantic-workflow.mjs';
import { normalizeDiagnosticQuestions, createDiagnosticRun, hasPossiblyTruncatedContent } from '../public/diagnostic-runner.js';

test('完整教学内容在模型结果、课堂题目与课堂记录之间无损传递', () => {
  const long = '第一问：分析条件与依据。'.repeat(80) + '\n第二问：说明边界情况。';
  const questions = Array.from({length:7}, () => ({prompt:long,answerCue:long,misconception:long}));
  const plan = normalizeLessonPlan({objectives:Array(6).fill(long),questions,flow:Array.from({length:8},()=>({teacherAction:long,studentAction:long,studentOutput:long,feedback:long})),afterClass:Array(6).fill(long)},[]);
  assert.equal(plan.questions.length,7);
  assert.equal(plan.objectives.length,6);
  assert.equal(plan.flow.length,8);
  assert.equal(plan.afterClass.length,6);
  assert.equal(plan.flow[0].teacherAction,long);
  const normalized=normalizeDiagnosticQuestions(plan.questions);
  const run=createDiagnosticRun(normalized);
  for(const field of ['prompt','answerCue','misconception']) assert.equal(run.observations[0][field],long);
  assert.equal(hasPossiblyTruncatedContent(run.observations[0]),false);
});

test('代码、实验步骤、评分标准和案例正文不因显示长度损坏',()=>{
  const long='完整说明。'.repeat(400), code='console.log("完整程序");\n'.repeat(500);
  const resources=[{type:'code',title:'程序',purpose:long,details:{code,sampleInput:long,walkthrough:long,traceSteps:Array.from({length:15},()=>({line:1,state:long,explanation:long}))}},{type:'lab',title:'实验',purpose:long,details:{objective:long,steps:Array(15).fill(long),rubric:Array.from({length:10},()=>({criterion:long,standard:long,points:1}))}},{type:'case',title:'案例',purpose:long,details:{scenario:long,questions:Array(12).fill(long)}}];
  const result=normalizeLessonPlan({resources},[]).resources;
  assert.equal(result[0].details.code,code);
  assert.equal(result[0].details.sampleInput,long);
  assert.equal(result[0].details.traceSteps.length,15);
  assert.equal(result[1].details.steps.length,15);
  assert.equal(result[1].details.rubric.length,10);
  assert.equal(result[2].details.scenario,long);
  assert.equal(result[2].details.questions.length,12);
});

test('旧数据省略号仅提示核对，不擅自补写或更改内容',()=>{
  assert.equal(hasPossiblyTruncatedContent({prompt:'条件…'}),true);
  assert.equal(hasPossiblyTruncatedContent({answerCue:'原因...'}),true);
  assert.equal(normalizeDiagnosticQuestions([{prompt:'条件…'}])[0].prompt,'条件…');
});
