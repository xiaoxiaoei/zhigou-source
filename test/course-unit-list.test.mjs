import test from 'node:test';
import assert from 'node:assert/strict';
import {reorderCourseUnits,renderCourseUnitList} from '../public/course-unit-list.js';
import {createCourseUnitSkeletons} from '../public/course-batch.js';
import {normalizeOutlineUnits} from '../src/course-outline.mjs';
test('drag insert persists exact order without removing other course members',()=>{
  const c={name:'A',unitOrder:['a','b','c']},u=['a','b','c'].map(id=>({id,course:'A'}));u.push({id:'outside',course:'B'});
  assert.equal(reorderCourseUnits(c,u,'a','c',true),true);assert.deepEqual(c.unitOrder,['b','c','a']);
  assert.equal(reorderCourseUnits(c,u,'a','b',false),true);assert.deepEqual(c.unitOrder,['a','b','c']);
  assert.equal(reorderCourseUnits(c,u,'outside','a'),false);assert.equal(reorderCourseUnits(c,u,'a','a'),false);
});
test('merged unit list has entry, edit and keyboard drag handle, not schedule panels',()=>{
  const html=renderCourseUnitList([{id:'a',title:'1.1 链表',parentChapter:'第一章 线性表',outlineLevel:'section',keyPoints:[]}],[{unitId:'a',kind:'analyze',label:'开始分析',description:'准备材料'}]);
  for(const token of ['data-unit-drag','data-unit-meta','data-open-course-unit','开始分析','第一章 线性表'])assert.ok(html.includes(token));
  assert.ok(!html.includes('授课安排'));assert.ok(!html.includes('教学单元顺序'));
});
test('chapter and section metadata survive skeleton construction without inventing knowledge',()=>{
  const titles=normalizeOutlineUnits({units:[{title:'1.1 链表',level:'section',parentTitle:'第一章 线性表'},{title:'第二章 树',level:'chapter'}]});
  const result=createCourseUnitSkeletons({course:{name:'课程'},titles,idFactory:()=>String(Math.random())});
  assert.equal(result.units[0].parentChapter,'第一章 线性表');assert.equal(result.units[0].outlineLevel,'section');assert.equal(result.units[1].outlineLevel,'chapter');assert.deepEqual(result.units[1].keyPoints,[]);
});
