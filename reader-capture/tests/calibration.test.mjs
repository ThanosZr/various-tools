import test from 'node:test';
import assert from 'node:assert/strict';
import {makeViewer} from './viewer-fixture.mjs';

test('red drag auto-scrolls at viewport edge; release keeps green full-page geometry',async()=>{
  for(const nested of [false,true]){
    const v=makeViewer(nested),start=nested?120:90,bottom=nested?649:699;
    await v.send('pick',{kind:'manual',opts:{edgeSpeed:950,lockRatio:true}});v.overlay().surface.fire('pointerdown',{clientX:170,clientY:start});
    v.document.fire('pointermove',{clientX:830,clientY:bottom});assert.match(v.overlay().frame.className,/red/);
    v.tick(28);assert.ok(v.scroller.scrollTop>300);
    const y=start+940-v.scroller.scrollTop;v.document.fire('pointerup',{clientX:830,clientY:y});await v.flush();
    const m=await v.send('selection');assert.equal(m.rect.width,660);assert.equal(m.rect.height,940);assert.doesNotMatch(v.overlay().frame.className,/red/);assert.ok(v.overlay().frame.isConnected);v.dispose();
  }
});
test('visual next-start measurement includes intervening wheel scrolling',async()=>{
  const v=makeViewer();await v.draw();await v.send('set-geometry',{values:{height:940}});await v.send('measure-gap');
  v.overlay().shadow.fire('wheel',{deltaY:900});assert.equal(v.scroller.scrollTop,900);
  v.overlay().surface.fire('pointerdown',{clientX:170,clientY:154});await v.flush();
  const s=await v.send('selection');assert.equal(s.step,964);assert.equal(s.gap,24);assert.equal(s.calibrated,true);assert.equal(v.notices.at(-1).type,'spacing-selected');v.dispose();
});
test('wheel interception blocks native scrolling once and avoids a second scroll for non-cancelable events',async()=>{
  const v=makeViewer();await v.draw();await v.send('measure-gap');
  const handled=v.overlay().shadow.fire('wheel',{deltaY:300});assert.equal(v.scroller.scrollTop,300);assert.equal(handled.defaultPrevented,true);
  const native=v.overlay().shadow.fire('wheel',{deltaY:200,cancelable:false});assert.equal(v.scroller.scrollTop,300);assert.equal(native.defaultPrevented,false);
  v.scroller.scrollTop+=200;v.tick();assert.equal(v.scroller.scrollTop,500);v.dispose();
});
test('corner handles preserve aspect ratio and retain a live selection',async()=>{
  const v=makeViewer();await v.draw();const original=await v.send('selection'),frame=v.overlay().frame,handle=frame.children.find(h=>h.dataset.handle==='se');
  handle.fire('pointerdown',{clientX:830,clientY:690});v.document.fire('pointermove',{clientX:896,clientY:750});v.document.fire('pointerup',{clientX:896,clientY:750});
  const m=await v.send('selection');assert.ok(Math.abs(m.rect.width/m.rect.height-original.aspect)<1e-12);assert.ok(Math.abs(m.rect.width-726)<1e-9);v.dispose();
});
test('page-relative selection and stride scale together after responsive reflow',async()=>{
  const v=makeViewer();await v.send('calibrate-auto');const before=await v.send('selection');v.setScale(.75);
  const after=await v.send('selection');assert.equal(after.rect.width,before.rect.width*.75);assert.equal(after.rect.height,before.rect.height*.75);assert.equal(after.step,before.step*.75);assert.equal(after.aspect,before.aspect);
  const next=await v.send('inspect',{opts:{mode:'manual',index:1}});assert.equal(next.rect.y-after.rect.y,after.step);v.dispose();
});
test('Chrome zoom/DPR changes keep selection in CSS space and follow the page position',async()=>{
  const v=makeViewer();await v.draw();await v.send('set-geometry',{values:{height:940,gap:24}});v.setZoom(.8);
  const s=await v.send('selection');assert.equal(s.rect.width,660);assert.equal(s.rect.height,940);assert.equal(s.step,964);assert.equal(s.rect.x,(1250-660)/2);assert.equal(s.viewport.dpr,.8);v.dispose();
});
test('live first/next page anchors preserve a fixed CSS gap after zoom-related reflow',async()=>{
  const v=makeViewer();v.setFixedGap();await v.send('calibrate-auto');v.setScale(.75);const s=await v.send('selection');assert.equal(s.rect.height,705);assert.equal(s.step,729);assert.equal(s.gap,24);v.dispose();
});
test('a zoom during capture rejects only that page, then the calibrated region remains usable',async()=>{
  const v=makeViewer();await v.draw();await v.send('set-geometry',{values:{height:940,gap:24}});await v.send('begin-run');await v.send('begin',{opts:{mode:'manual',index:0}});
  v.events.keydown({ctrlKey:true,key:'-'});v.setZoom(.8);await assert.rejects(()=>v.send('metrics'),{code:'VIEWPORT_CHANGED'});await v.send('end',{restore:false});
  const fresh=await v.send('begin',{opts:{mode:'manual',index:0}});assert.equal(fresh.rect.width,660);await v.send('end-run');v.dispose();
});
test('batch reaches each exact calibrated position and stops before an incomplete final rectangle',async()=>{
  const v=makeViewer();await v.draw();await v.send('set-geometry',{values:{height:940,gap:24}});await v.send('begin-run');
  for(let index=0;index<3;index++){await v.send('prepare',{index});const m=await v.send('begin',{opts:{mode:'manual',index}});assert.equal(m.label,String(index+1));await v.send('end',{restore:false});}
  await assert.rejects(()=>v.send('prepare',{index:3}),{code:'PAGE_END'});await v.send('end-run');assert.equal(v.scroller.scrollTop,0);v.dispose();
});
test('reinjection disposes old listeners and ignores legacy installed flags',async()=>{
  const v=makeViewer();await v.draw();v.ctx.__readerCaptureInstalled=true;v.reinject();assert.equal(v.messageHandlers.size,1);assert.equal((await v.send('ping')).version,'3.0.0');await v.draw();assert.ok(v.overlay());v.dispose();assert.equal(v.messageHandlers.size,0);
});
