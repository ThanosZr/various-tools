import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {makeViewer,Element} from './viewer-fixture.mjs';
import {capturePageWalk} from '../extension/lib/page-capture.js';
import {renderScanRegion,splitRanges} from '../extension/lib/split.js';
const require=createRequire(import.meta.url),{createCanvas,loadImage}=require(require.resolve('@napi-rs/canvas',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||process.cwd()]}));
globalThis.document={createElement:()=>{const c=createCanvas(1,1);c.toBlob=(cb,type)=>cb(new Blob([c.toBuffer(type)],{type}));return c;}};
globalThis.createImageBitmap=async blob=>{const im=await loadImage(Buffer.from(await blob.arrayBuffer()));im.close=()=>{};return im;};

function pattern(height,index){const c=createCanvas(660,height),ctx=c.getContext('2d');for(let y=0;y<height;y++){ctx.fillStyle=`rgb(${(y+index*31)%197+25},${(y+index*17)%173+20},${y%149+35})`;ctx.fillRect(0,y,660,1);}return c;}
async function setup({nested=false,heights=[940,940,940],gaps=[24,24],bar=true,dpr=1}={}){
  const v=makeViewer(nested),pictures=heights.slice(0,v.pages.length).map(pattern),positions=[];
  let top=nested?20:90;
  v.pages.forEach((p,i)=>{positions.push(top);const y=top;p.getBoundingClientRect=()=>({x:170,y:(nested?100:0)+y-v.scroller.scrollTop,width:660,height:heights[i]});p.clientHeight=p.scrollHeight=heights[i];top+=heights[i]+(gaps[i]||0);});
  v.scroller.scrollHeight=top+40;v.scroller.scrollTop=160;
  v.ctx.devicePixelRatio=dpr;
  if(bar){
    const wrapper=new Element('div',v.document.body);wrapper.style.position='fixed';wrapper.clientHeight=700;
    const floating=v.addBar({x:0,y:350,width:1000,height:38});floating.tagName='DIV';floating.parentElement=wrapper;floating.position='absolute';floating.style.backgroundColor='rgb(0, 255, 0)';wrapper.append(floating);
    v.addBar({x:0,y:0,width:1000,height:64});
  }
  const metadata=new Map(),tiles=new Map(),operations=[],moves=[],shots=[];
  const opts={walkMode:'auto',walkSpeed:'careful',walkStep:220,autoExcludeBars:true,topInset:0,bottomInset:0,wait:80,returnPosition:true};
  const command=async(op,extra={})=>{operations.push(op);const before=v.scroller.scrollTop,r=await v.send(op,{opts,...extra});if(op==='move'||op==='walk-next')moves.push(Math.abs(v.scroller.scrollTop-before));return r;};
  const screenshot=async()=>{
    const c=createCanvas(1000*dpr,700*dpr),ctx=c.getContext('2d');ctx.scale(dpr,dpr);ctx.fillStyle='#eeeeee';ctx.fillRect(0,0,1000,700);
    v.pages.forEach((p,i)=>{const r=p.getBoundingClientRect();ctx.drawImage(pictures[i],r.x,r.y);});
    ctx.fillStyle='#00ff00';for(const b of v.bars){const r=b.getBoundingClientRect();ctx.fillRect(r.x,r.y,r.width,r.height);}
    shots.push(v.scroller.scrollTop);const im=await loadImage(c.toBuffer('image/png'));im.close=()=>{};return im;
  };
  const save=async s=>metadata.set(s.id,structuredClone(s));
  const commit=async(s,list,page)=>{
    assert.equal(page.top,s.savedHeight);let bottom=s.savedHeight;
    for(const tile of list){assert.equal(tile.y,bottom);bottom+=tile.height;tiles.set(tile.id,tile);}
    assert.equal(page.bottom,bottom);s.tiles.push(...list.map(({blob,...t})=>t));s.pages.push(page);s.cuts.push(bottom);s.height=s.savedHeight=bottom;await save(s);
  };
  const expectedPictures=pictures.map((im,i)=>{const c=createCanvas(Math.round(660*dpr),Math.round(heights[i]*dpr)),ctx=c.getContext('2d');ctx.fillStyle='#eeeeee';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(im,170*dpr-Math.round(170*dpr),((nested?100:0)+positions[i])*dpr-Math.round(((nested?100:0)+positions[i])*dpr),660*dpr,heights[i]*dpr);return c;});
  return {v,pictures:expectedPictures,positions,opts,command,screenshot,save,commit,metadata,tiles,operations,moves,shots};
}
async function equalPixels(f,scan,index){
  const p=scan.pages[index],r=await renderScanRegion(scan,p,id=>f.tiles.get(id),{type:'image/png'}),im=await loadImage(Buffer.from(await r.blob.arrayBuffer())),expected=f.pictures[index];
  assert.equal(im.width,expected.width);assert.equal(im.height,expected.height);
  const c=createCanvas(im.width,im.height),ctx=c.getContext('2d');ctx.drawImage(im,0,0);
  const a=Buffer.from(ctx.getImageData(0,0,c.width,c.height).data),b=Buffer.from(expected.getContext('2d').getImageData(0,0,c.width,c.height).data);
  const diff=a.findIndex((v,i)=>v!==b[i]);assert.equal(diff,-1,`first differing pixel row ${Math.floor(diff/(c.width*4))}: ${a[diff]} / ${b[diff]}`);
}

test('slow page walk captures variable heights and gaps, including an unnamed absolute bar inside a fixed wrapper',async()=>{
  const f=await setup({heights:[940,1110,700],gaps:[85,17]});
  try{
    const scan=await capturePageWalk({...f,count:8});
    assert.equal(scan.status,'complete');assert.equal(scan.reason,'end');assert.equal(scan.pages.length,3);
    assert.equal(scan.savedHeight,2750);assert.deepEqual(scan.cuts,[0,940,2050,2750]);
    assert.ok(f.moves.every(n=>n<=220.01),'every movement uses the configured small step');
    assert.ok(!f.operations.includes('strip-preload'),'there is no whole-document preload pass');
    assert.equal(f.v.scroller.scrollTop,160);assert.equal(splitRanges(scan.cuts,scan.savedHeight,scan.settings).length,3);
    for(let i=0;i<3;i++)await equalPixels(f,scan,i);
  }finally{f.v.dispose();}
});
test('a fitting page is centered and captured once, while a tall page merges only the exact remainder',async()=>{
  const f=await setup({heights:[940,300,940],bar:false});
  try{
    const scan=await capturePageWalk({...f,count:2});assert.equal(scan.pages.length,2);
    assert.equal(f.positions[1]-f.shots.at(-1),200,'the fitting 300px page is centered in the 700px viewport');
    assert.equal(scan.tiles.filter(t=>t.y>=940).length,1);assert.equal(scan.savedHeight,1240);
    await equalPixels(f,scan,0);await equalPixels(f,scan,1);
  }finally{f.v.dispose();}
});
test('cancellation midway through the next page preserves only complete pages',async()=>{
  const f=await setup();let stopped=false;
  try{
    await assert.rejects(()=>capturePageWalk({...f,count:3,onProgress:p=>{if(p.stage==='capture'&&p.completed===1)stopped=true;},checkStop:()=>{if(stopped)throw new Error('stopped');}}),/stopped/);
    const scan=[...f.metadata.values()][0];assert.equal(scan.status,'partial');assert.equal(scan.pages.length,1);assert.equal(scan.savedHeight,940);assert.deepEqual(scan.cuts,[0,940]);
    assert.equal(f.v.scroller.scrollTop,160);await equalPixels(f,scan,0);
  }finally{f.v.dispose();}
});
test('a toolbar that moves during capture discards that page attempt and retries with fresh screen geometry',async()=>{
  const f=await setup();let changed=false,retries=0;
  try{
    const original=f.screenshot;
    const scan=await capturePageWalk({...f,count:1,screenshot:async()=>{const im=await original();if(!changed){changed=true;const b=f.v.bars[0];b.getBoundingClientRect=()=>({x:0,y:260,width:1000,height:38});}return im;},onProgress:p=>{if(p.stage==='retry')retries++;}});
    assert.equal(scan.pages.length,1);assert.equal(retries,1);await equalPixels(f,scan,0);
  }finally{f.v.dispose();}
});
test('nested viewers use their own clipping rectangle and stop at the requested page count',async()=>{
  const f=await setup({nested:true,heights:[940,850],gaps:[31],bar:false});
  try{const scan=await capturePageWalk({...f,count:2});assert.equal(scan.pages.length,2);assert.equal(scan.savedHeight,1790);assert.equal(f.v.scroller.scrollTop,160);for(let i=0;i<2;i++)await equalPixels(f,scan,i);}
  finally{f.v.dispose();}
});
test('zoom during discovery aborts and restores the reading position instead of mixing resolutions',async()=>{
  const f=await setup();let zoomed=false;
  try{
    const command=async(op,extra)=>{const r=await f.command(op,extra);if(op==='walk-next'&&!zoomed){zoomed=true;f.v.setZoom(.8);}return r;};
    await assert.rejects(()=>capturePageWalk({...f,count:2,command}),e=>e.code==='VIEWPORT_CHANGED');
    const scan=[...f.metadata.values()][0];assert.equal(scan.pages.length,0);assert.equal(scan.savedHeight,0);assert.equal(scan.status,'failed');
  }finally{f.v.dispose();}
});
test('manual template remains available when automatic page elements are unavailable',async()=>{
  const f=await setup({bar:false});
  try{
    f.v.scroller.scrollTop=0;await f.v.draw();await f.v.send('set-geometry',{values:{height:940,gap:24}});f.opts.walkMode='template';
    const query=f.v.document.querySelectorAll;f.v.document.querySelectorAll=s=>s.includes('.page')?[]:query(s);f.v.document.elementFromPoint=()=>f.v.document.body;
    const scan=await capturePageWalk({...f,count:2});assert.equal(scan.pages.length,2);assert.equal(scan.savedHeight,1880);for(let i=0;i<2;i++)await equalPixels(f,scan,i);
  }finally{f.v.dispose();}
});
test('device-pixel alignment keeps exact rows at DPR 1.25 and 2, including the clamped final viewport',async()=>{
  for(const dpr of [1.25,2]){
    const f=await setup({dpr});
    try{const scan=await capturePageWalk({...f,count:3});assert.equal(scan.savedHeight,2820*dpr);for(let i=0;i<3;i++)await equalPixels(f,scan,i);}
    finally{f.v.dispose();}
  }
});
test('an initial scroll probe detects UI held stationary by script before the first capture',async()=>{
  const f=await setup({bar:false});f.v.scroller.scrollTop=0;
  const b=f.v.addBar({x:0,y:350,width:1000,height:38});b.tagName='DIV';b.position='absolute';b.style.backgroundColor='rgb(0, 255, 0)';
  try{const scan=await capturePageWalk({...f,count:1});assert.ok(f.operations.filter(op=>op==='walk-next').length>=3);await equalPixels(f,scan,0);assert.equal(f.v.scroller.scrollTop,0);}
  finally{f.v.dispose();}
});
test('fast snapshots fill several visible bands, merge by saved position and reduce the number of screenshots',async()=>{
  const slow=await setup(),fast=await setup();fast.opts.walkSpeed='fast';slow.opts.walkStep=fast.opts.walkStep=140;
  try{
    const a=await capturePageWalk({...slow,count:3}),b=await capturePageWalk({...fast,count:3});
    assert.deepEqual(b.cuts,a.cuts);assert.ok(fast.shots.length<slow.shots.length,`${fast.shots.length} fast vs ${slow.shots.length} careful frames`);
    assert.ok(b.tiles.some(t=>t.source?.position),'every captured piece retains its original screen position');
    for(let i=0;i<3;i++)await equalPixels(fast,b,i);
  }finally{slow.v.dispose();fast.v.dispose();}
});
test('fast capture preserves exact pixels at fractional DPR and variable page heights',async()=>{
  for(const dpr of [1,1.25,2]){
    const f=await setup({dpr,heights:[940,1110,700],gaps:[85,17]});f.opts.walkSpeed='fast';
    try{const scan=await capturePageWalk({...f,count:3});for(let i=0;i<3;i++)await equalPixels(f,scan,i);assert.deepEqual(scan.pages.map(p=>p.bottom-p.top),[940,1110,700].map(n=>Math.round(n*dpr)));}
    finally{f.v.dispose();}
  }
});
test('fast capture rejects every provisional band if a toolbar moves during that screenshot',async()=>{
  const f=await setup();f.opts.walkSpeed='fast';let changed=false,retries=0;
  try{const original=f.screenshot,scan=await capturePageWalk({...f,count:1,screenshot:async()=>{const im=await original();if(!changed){changed=true;f.v.bars[0].getBoundingClientRect=()=>({x:0,y:250,width:1000,height:38});}return im;},onProgress:p=>{if(p.stage==='retry')retries++;}});assert.equal(retries,1);await equalPixels(f,scan,0);}
  finally{f.v.dispose();}
});
test('cancelling fast out-of-order capture retains only the complete previous page',async()=>{
  const f=await setup();f.opts.walkSpeed='fast';let stopped=false;
  try{
    await assert.rejects(()=>capturePageWalk({...f,count:3,onProgress:p=>{if(p.stage==='capture'&&p.completed===1)stopped=true;},checkStop:()=>{if(stopped)throw new Error('stopped');}}),/stopped/);
    const scan=[...f.metadata.values()][0];assert.equal(scan.pages.length,1);assert.equal(scan.savedHeight,940);assert.deepEqual(scan.cuts,[0,940]);await equalPixels(f,scan,0);assert.equal(f.v.scroller.scrollTop,160);
  }finally{f.v.dispose();}
});
test('loading more document height below a stationary page does not prevent its first screenshot',async()=>{
  const f=await setup();f.opts.walkSpeed='fast';let height=f.v.scroller.scrollHeight;
  Object.defineProperty(f.v.scroller,'scrollHeight',{configurable:true,get:()=>++height});
  try{const scan=await capturePageWalk({...f,count:1});assert.equal(scan.pages.length,1);assert.equal(scan.performance.retries,0);assert.ok(f.shots.length>0);await equalPixels(f,scan,0);}
  finally{f.v.dispose();}
});
test('tiny compositor-coordinate jitter in a toolbar does not count as unstable content',async()=>{
  const f=await setup();f.opts.walkSpeed='fast';let n=0;
  f.v.bars[0].getBoundingClientRect=()=>({x:0,y:350+(++n%2)*.01,width:1000,height:38});
  try{const scan=await capturePageWalk({...f,count:1});assert.equal(scan.performance.retries,0);await equalPixels(f,scan,0);}
  finally{f.v.dispose();}
});
test('early discovery failures visibly retry and use temporary careful capture for the same page',async()=>{
  const f=await setup();f.opts.walkSpeed='fast';let failures=0;const progress=[],modes=[];
  const command=async(op,extra)=>{if(op==='walk-next'&&failures++<2)throw Object.assign(new Error('not settled yet'),{code:'LAYOUT_CHANGED'});const r=await f.command(op,extra);if(r?.state==='page')modes.push(r.mode);return r;};
  try{
    const scan=await capturePageWalk({...f,count:2,command,onProgress:p=>{if(p.stage==='retry')progress.push(p);}});
    assert.deepEqual(progress.map(p=>[p.attempt,p.phase,p.mode]),[[1,'search','fast'],[2,'search','careful']]);
    assert.deepEqual(modes,['careful','fast']);assert.equal(scan.performance.retries,2);assert.equal(scan.performance.carefulFallbacks,1);assert.deepEqual(scan.pages.map(p=>p.label),['1','2']);
    for(let i=0;i<2;i++)await equalPixels(f,scan,i);
  }finally{f.v.dispose();}
});
test('permanent discovery instability stops only after four attempts and keeps the original position',async()=>{
  const f=await setup();f.opts.walkSpeed='fast';let attempts=0,retries=0;
  const command=async(op,extra)=>{if(op==='walk-next'){attempts++;throw Object.assign(new Error('still moving'),{code:'LAYOUT_CHANGED'});}return f.command(op,extra);};
  try{
    await assert.rejects(()=>capturePageWalk({...f,count:1,command,onProgress:p=>{if(p.stage==='retry')retries++;}}),e=>e.code==='LAYOUT_CHANGED'&&e.attempts===4&&e.phase==='search'&&e.completedPages===0);
    assert.equal(attempts,4);assert.equal(retries,3);assert.equal(f.shots.length,0);assert.equal(f.v.scroller.scrollTop,160);
  }finally{f.v.dispose();}
});
test('a final validation failure is retried without committing the page twice',async()=>{
  const f=await setup();f.opts.walkSpeed='fast';let failed=false;
  const command=async(op,extra)=>{if(op==='walk-commit'&&!failed){failed=true;throw Object.assign(new Error('bar moved before commit'),{code:'LAYOUT_CHANGED'});}return f.command(op,extra);};
  try{const scan=await capturePageWalk({...f,count:1,command});assert.equal(scan.performance.retries,1);assert.equal(scan.pages.length,1);assert.deepEqual(scan.cuts,[0,940]);await equalPixels(f,scan,0);}
  finally{f.v.dispose();}
});
test('a page shifted above its old discovery cursor is pinned during recovery instead of being skipped',async()=>{
  const f=await setup();f.opts.walkSpeed='fast';let shifted=false;const original=f.screenshot,rect=f.v.pages[0].getBoundingClientRect;
  try{
    const scan=await capturePageWalk({...f,count:2,screenshot:async()=>{const im=await original();if(!shifted){shifted=true;f.v.pages[0].getBoundingClientRect=()=>({...rect(),y:rect().y-12});}return im;}});
    assert.deepEqual(scan.pages.map(p=>p.label),['1','2']);assert.equal(scan.performance.retries,1);for(let i=0;i<2;i++)await equalPixels(f,scan,i);
  }finally{f.v.dispose();}
});
test('stopping during recovery cancels further attempts',async()=>{
  const f=await setup();f.opts.walkSpeed='fast';let stopped=false,retries=0;
  const command=async(op,extra)=>{if(op==='walk-next')throw Object.assign(new Error('not stable'),{code:'LAYOUT_CHANGED'});return f.command(op,extra);};
  try{
    await assert.rejects(()=>capturePageWalk({...f,count:1,command,checkStop:()=>{if(stopped)throw new Error('stopped');},onProgress:p=>{if(p.stage==='retry'){retries++;stopped=true;}}}),/stopped/);
    assert.equal(retries,1);assert.equal(f.shots.length,0);assert.equal(f.v.scroller.scrollTop,160);
  }finally{f.v.dispose();}
});
