import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deleteTeachingUnit} from '../public/unit-deletion.js';

test('确认删除示例后允许零单元，序列化后不会复活',()=>{
  const result=deleteTeachingUnit([{id:'sync',isDemo:true}],[],'sync',{allowDemo:true});
  assert.equal(result.deleted,true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.units)),[]);
  assert.deepEqual(result.courses,[]);
});
test('删除示例不删除个人内容或课程',()=>{
  const personal={id:'mine'},course={id:'course',unitOrder:['sync','mine']};
  const result=deleteTeachingUnit([{id:'sync',isDemo:true},personal],[course],'sync',{allowDemo:true});
  assert.deepEqual(result.units,[personal]);
  assert.deepEqual(result.courses,[{id:'course',unitOrder:['mine']}]);
});
test('空工作区启动不重新注入示例，也没有隐藏或恢复入口',()=>{
  const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.ok(!app.includes('...baseUnits'));
  assert.ok(!app.includes('restoreDemoButton'));
  assert.ok(!app.includes('hideDemoButton'));
  assert.ok(app.includes('还没有教学单元'));
});
