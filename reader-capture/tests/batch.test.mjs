import test from 'node:test';
import assert from 'node:assert/strict';
import {runBatch} from '../extension/lib/batch.js';
import {PageBridge,VERSION,friendlyError} from '../extension/lib/bridge.js';

test('N-page run captures exactly N positions in order and counts existing pages',async()=>{
  const positions=[],result=await runBatch({first:2,count:3,prepare:async i=>positions.push('p'+i),capture:async i=>{positions.push('c'+i);return {added:i!==3};}});
  assert.deepEqual(positions,['p2','c2','p3','c3','p4','c4']);assert.equal(result.completed,3);assert.equal(result.added,2);assert.equal(result.duplicates,1);assert.equal(result.next,5);
});
test('end-of-document terminates safely; unrelated failures retain partial progress',async()=>{
  const options={count:10,prepare:async i=>{if(i===2)throw Object.assign(new Error('end'),{code:'PAGE_END'});},capture:async()=>({added:true})};
  const result=await runBatch(options);assert.equal(result.reason,'end');assert.equal(result.completed,2);
  await assert.rejects(()=>runBatch({...options,prepare:async i=>{if(i===1)throw new Error('lost page');}}),e=>e.batch.completed===1&&e.batch.next===1);
});
test('zoom retry repeats the same position and does not duplicate completed pages',async()=>{
  const attempts=[],settled=[];let first=true;
  const result=await runBatch({count:2,prepare:async()=>{},capture:async i=>{attempts.push(i);if(first){first=false;throw Object.assign(new Error('zoom'),{code:'VIEWPORT_CHANGED'});}return {added:true};},settle:async(e,i)=>settled.push(i)});
  assert.deepEqual(attempts,[0,0,1]);assert.deepEqual(settled,[0]);assert.equal(result.completed,2);
});
test('stop at a page boundary retains completed work',async()=>{
  let stopped=false;await assert.rejects(()=>runBatch({count:3,prepare:async()=>{},capture:async()=>({added:true}),onProgress:()=>stopped=true,checkStop:()=>{if(stopped)throw new Error('stop');}}),e=>e.batch.completed===1);
});
test('bridge resolves an absent target and reinstalls an outdated receiver',async()=>{
  let version='1.0.0',injections=0;const tab={id:7,windowId:1,active:true,url:'https://example.test'};
  const api={runtime:{id:'ext'},tabs:{query:async()=>[tab],get:async()=>tab,sendMessage:async()=>({ok:true,data:{version}})},scripting:{executeScript:async()=>{injections++;version=VERSION;}}};
  const bridge=new PageBridge(api);assert.equal((await bridge.ensure()).id,7);assert.equal(injections,1);await bridge.ensure(tab);assert.equal(injections,1);
});
test('bridge preserves actionable viewer errors and refuses a different active tab',async()=>{
  const api={runtime:{id:'ext'},tabs:{get:async()=>({id:7,active:false}),sendMessage:async()=>({ok:false,error:'zoom',code:'VIEWPORT_CHANGED'})}};const bridge=new PageBridge(api);
  await assert.rejects(()=>bridge.resolve({id:7}),/Επίστρεψε/);await assert.rejects(()=>bridge.call('begin',{}, {id:7}),{code:'VIEWPORT_CHANGED'});assert.match(friendlyError(new Error('Extension context invalidated')),/ανανεώθηκε/);
});
