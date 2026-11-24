import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotSlices,mergeRows,nextMissingRow} from '../extension/lib/snapshot-plan.js';

test('one frozen screenshot supplies bands above and below a toolbar without filling its hidden rows',()=>{
  const m={viewport:{width:1000,height:700,dpr:1},rect:{x:170,y:90,width:660,height:940},clip:{x:0,y:72,width:1000,height:270},clips:[{x:0,y:72,width:1000,height:270},{x:0,y:398,width:1000,height:302}]};
  const p=snapshotSlices(m,{width:1000,height:700});assert.deepEqual(p.slices.map(r=>[r.top,r.bottom]),[[0,252],[308,610]]);assert.equal(nextMissingRow(p.slices,940),252);
  const next=snapshotSlices({...m,rect:{...m.rect,y:-156}},{width:1000,height:700},p.slices);
  assert.deepEqual(next.slices.map(r=>[r.top,r.bottom]),[[252,308],[610,856]]);
  assert.equal(nextMissingRow([...p.slices,...next.slices],940),856);
});
test('interval union preserves holes, coalesces overlaps and never modifies the supplied ranges',()=>{
  const ranges=[{top:10,bottom:20},{top:0,bottom:5},{top:4,bottom:12},{top:30,bottom:40}],before=structuredClone(ranges);
  assert.deepEqual(mergeRows(ranges),[{top:0,bottom:20},{top:30,bottom:40}]);assert.equal(nextMissingRow(ranges,50),20);assert.deepEqual(ranges,before);
});
test('a fitting whole page is cropped once and a completely covered viewport produces no duplicate slices',()=>{
  const m={viewport:{width:1000,height:700,dpr:1.25},rect:{x:170,y:90,width:660,height:300},clip:{x:0,y:0,width:1000,height:700}};
  const p=snapshotSlices(m,{width:1250,height:875});assert.equal(p.width,825);assert.equal(p.height,375);assert.deepEqual(p.slices.map(r=>[r.top,r.bottom,r.y]),[[0,375,113]]);
  assert.deepEqual(snapshotSlices(m,{width:1250,height:875},p.slices).slices,[]);
});
