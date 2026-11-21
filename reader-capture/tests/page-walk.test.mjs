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
  const opts={walkMode:'auto',walkStep:220,autoExcludeBars:true,topInset:0,bottomInset:0,wait:80,returnPosition:true};
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
