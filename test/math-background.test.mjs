import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import katex from 'katex';
import {normalizeMathSource} from '../public/math-source.js';
test('model escaped subscript renders as a mathematical subscript',()=>{const source=String.raw`T = IC \times CPI \times T\_{cycle}`;const fixed=normalizeMathSource(source);assert.equal(fixed,String.raw`T = IC \times CPI \times T_{cycle}`);const html=katex.renderToString(fixed,{throwOnError:true,trust:false});assert.match(html,/<msub>/);assert.match(html,/cycle/);});
test('literal escaped underscore remains literal except grouped model subscript',()=>{assert.equal(normalizeMathSource(String.raw`x\_y`),String.raw`x\_y`);assert.equal(normalizeMathSource(String.raw`a_{i}^{2}`),String.raw`a_{i}^{2}`);});
test('math is local, ignores editors and code, and refuses trusted commands',()=>{const code=fs.readFileSync(new URL('../public/math-rendering.js',import.meta.url),'utf8');assert.match(code,/vendor\/katex/);assert.match(code,/trust:false/);assert.match(code,/textarea/);assert.match(code,/svg/);assert.match(code,/observer.disconnect/);});
test('background generation reconnects existing job without resubmission and avoids completion popup',()=>{const code=fs.readFileSync(new URL('../public/teaching-studio.js',import.meta.url),'utf8');assert.match(code,/if\(active\)return reconnect\(active\)/);assert.match(code,/if\(saved\)/);assert.match(code,/dialog.open&&dialog.querySelector\('\.studio-progress'\)/);assert.match(code,/teaching-last-result/);const reconnect=code.slice(code.indexOf('async function reconnect'),code.indexOf('async function run'));assert.doesNotMatch(reconnect,/\/api\/teaching-task/);});
