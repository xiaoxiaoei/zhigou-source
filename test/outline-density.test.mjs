import test from 'node:test';
import assert from 'node:assert/strict';
import {extractOutlineUnits,normalizeOutlineUnits} from '../src/course-outline.mjs';
import {createCourseUnitSkeletons} from '../public/course-batch.js';
import {lessonDensityIssues} from '../src/lesson-density.mjs';
import {fitLessonDuration} from '../src/lesson-constraints.mjs';
import JSZip from 'jszip';
import {parseTeachingDocument} from '../src/document-parser.mjs';
test('Word syllabus text feeds structural extraction without generating unit content',async()=>{
  const zip=new JSZip();zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>第一章 线性表</w:t></w:r></w:p><w:p><w:r><w:t>第二章 树与二叉树</w:t></w:r></w:p></w:body></w:document>');
  const deck=await parseTeachingDocument(await zip.generateAsync({type:'nodebuffer'}),'课程大纲.docx');
  const units=await extractOutlineUnits(deck.slides.map(s=>s.text).join('\n'),{completeJson:async({prompt})=>{assert.match(prompt,/第一章 线性表/);assert.match(prompt,/第二章 树与二叉树/);return {units:[{title:'第一章 线性表'},{title:'第二章 树与二叉树'}]};}});
  assert.equal(units.length,2);
});
test('outline extraction only returns ordered unique skeleton titles',async()=>{
  let calls=0;
  const units=await extractOutlineUnits('第一章 数组\n第二章 查找',{completeJson:async()=>{calls++;return {units:[{title:'数组',keyPoints:['not allowed']},{title:'查找'},{title:'数组'}]};}});
  assert.deepEqual(units,[{title:'数组'},{title:'查找'}]);assert.equal(calls,1);
  const result=createCourseUnitSkeletons({course:{name:'测试课程'},titles:units.map(u=>u.title),idFactory:()=>String(Math.random())});
  assert.equal(result.units.length,2);for(const u of result.units){assert.deepEqual(u.keyPoints,[]);assert.deepEqual(u.lesson.flow,[]);assert.deepEqual(u.resources,[]);assert.deepEqual(u.animations,[]);}
});
test('outline rejects empty, oversized and invalid model output',async()=>{
  await assert.rejects(()=>extractOutlineUnits('',{}));await assert.rejects(()=>extractOutlineUnits('字'.repeat(60001),{}));assert.throws(()=>normalizeOutlineUnits({units:[]}));
});
test('quick question is not stretched into a twenty minute lesson',()=>{
  const plan={flow:[{phase:'选择题',minutes:20,teacherAction:'展示一道选择题',studentAction:'独立作答'}],assessment:[{prompt:'题目'}]};
  assert.ok(lessonDensityIssues(plan,20).length);
  const result=fitLessonDuration(plan,20);assert.equal(result.flow[0].minutes,4);assert.equal(result.unallocatedMinutes,16);
});
test('long substantive discussion is not treated as quick question',()=>{
  const result=fitLessonDuration({flow:[{phase:'方案比较',minutes:20,teacherAction:'小组分析选择题，进行方案比较与错因分析',studentAction:'提交比较表'}]},20);assert.equal(result.flow[0].minutes,20);
});
