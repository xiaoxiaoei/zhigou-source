import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClassroomProgress, saveClassroomProgress } from '../public/classroom-progress.js';

test('classroom progress survives reopening, isolates units, and rejects changed lesson flow', () => {
  const map = new Map(), storage = { getItem: key => map.get(key), setItem: (key, value) => map.set(key, value) };
  const unit = { id: 'a', lesson: { flow: [{ phase: '引入', minutes: 10 }] } };
  assert.equal(loadClassroomProgress(storage, unit), 0);
  assert.equal(saveClassroomProgress(storage, unit, 125.5), true);
  assert.equal(loadClassroomProgress(storage, structuredClone(unit)), 125.5);
  assert.equal(loadClassroomProgress(storage, { ...unit, id: 'b' }), 0);
  assert.equal(loadClassroomProgress(storage, { ...unit, lesson: { flow: [{ phase: '引入', minutes: 20 }] } }), 0);
  saveClassroomProgress(storage, unit, 0);
  assert.equal(loadClassroomProgress(storage, unit), 0);
});

test('classroom progress handles unavailable storage and invalid records', () => {
  const unit = { id: 'a' };
  assert.equal(loadClassroomProgress({ getItem: () => 'broken json' }, unit), 0);
  assert.equal(loadClassroomProgress({ getItem: () => '{"signature":"[]","seconds":-2}' }, unit), 0);
  assert.equal(saveClassroomProgress({ setItem: () => { throw Error('quota'); } }, unit, 1), false);
  assert.equal(saveClassroomProgress({}, unit, NaN), false);
});
