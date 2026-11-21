import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {inflateSync} from 'node:zlib';
import {makeViewer} from './viewer-fixture.mjs';
import {captureScan} from '../extension/lib/scan-capture.js';
import {normalizeCuts,regularCuts,splitRanges,renderScanRegion,makeLongPNG} from '../extension/lib/split.js';
import {crc32} from '../extension/lib/zip.js';
const require=createRequire(import.meta.url),{createCanvas,loadImage}=require(require.resolve('@napi-rs/canvas',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||process.cwd()]}));
globalThis.document={createElement:()=>{const c=createCanvas(1,1);c.toBlob=(cb,type,quality)=>cb(new Blob([c.toBuffer(type,type==='image/jpeg'?quality:undefined)],{type}));return c;}};
globalThis.createImageBitmap=async blob=>{const im=await loadImage(Buffer.from(await blob.arrayBuffer()));im.close=()=>{};return im;};
const imageBlob=c=>new Blob([c.toBuffer('image/png')],{type:'image/png'});
function reference(){const c=createCanvas(660,2868),ctx=c.getContext('2d');for(let y=0;y<c.height;y++){ctx.fillStyle=`rgb(${y%197+25},${y%173+20},${y%149+35})`;ctx.fillRect(0,y,c.width,1);}return c;}
async function fixture(){
  const v=makeViewer();await v.draw();await v.send('set-geometry',{values:{height:940,gap:24}});v.scroller.scrollTop=250;
  v.addBar({x:0,y:0,width:1000,height:64});v.addBar({x:0,y:350,width:1000,height:40});v.addBar({x:0,y:680,width:1000,height:20});
  const original=reference(),tiles=new Map(),metadata=new Map(),operations=[];let screenshots=0;
  const opts={mode:'manual',rangeMode:'repeat',autoExcludeBars:true,topInset:0,bottomInset:0,wait:80,returnPosition:true};
  const command=async(op,extra={})=>{operations.push(op);return v.send(op,{opts,...extra});};
  const screenshot=async()=>{assert.ok(operations.includes('strip-ready'),'screenshots start only after preload');screenshots++;const c=createCanvas(1000,700),ctx=c.getContext('2d');ctx.fillStyle='#fafafa';ctx.fillRect(0,0,1000,700);ctx.drawImage(original,170,90-v.scroller.scrollTop);ctx.fillStyle='#00ff00';for(const b of v.bars){const r=b.getBoundingClientRect();ctx.fillRect(r.x,r.y,r.width,r.height);}const im=await loadImage(c.toBuffer('image/png'));im.close=()=>{};return im;};
  const save=async scan=>metadata.set(scan.id,structuredClone(scan));
  const append=async(scan,t)=>{assert.equal(t.y,scan.savedHeight);tiles.set(t.id,t);scan.tiles.push({id:t.id,y:t.y,height:t.height,width:t.width});scan.savedHeight=t.y+t.height;await save(scan);};
  return {v,original,tiles,metadata,operations,command,screenshot,save,append,opts,get screenshots(){return screenshots;}};
}

test('continuous capture excludes top/middle/bottom persistent bars without losing or duplicating pixels',async()=>{
  const f=await fixture();try{
    const scan=await captureScan({...f,count:3});assert.equal(scan.status,'complete');assert.equal(scan.savedHeight,2868);assert.equal(scan.width,660);assert.ok(f.screenshots>4);assert.equal(f.v.scroller.scrollTop,250);
    const merged=await renderScanRegion(scan,{top:0,bottom:2868},id=>f.tiles.get(id),{type:'image/png'}),im=await loadImage(Buffer.from(await merged.blob.arrayBuffer())),c=createCanvas(660,2868);c.getContext('2d').drawImage(im,0,0);
    const actual=Buffer.from(c.getContext('2d').getImageData(0,0,660,2868).data),expected=Buffer.from(f.original.getContext('2d').getImageData(0,0,660,2868).data),diff=actual.findIndex((b,i)=>b!==expected[i]);assert.equal(diff,-1,`First pixel difference at row ${Math.floor(diff/2640)}, channel ${diff%4}: ${actual[diff]} vs ${expected[diff]}`);
    const pages=splitRanges(regularCuts(2868,964),2868,{maxHeight:940});assert.deepEqual(pages.map(p=>[p.top,p.bottom]),[[0,940],[964,1904],[1928,2868]]);
    const calls=[],region=await renderScanRegion(scan,{top:300,bottom:1700},id=>{calls.push(id);return f.tiles.get(id);},{type:'image/png'});assert.equal(region.height,1400);assert.ok(calls.length<scan.tiles.length);
  }finally{f.v.dispose();}
});
test('cancelling an image capture preserves a contiguous partial scan and restores scrolling',async()=>{
  const f=await fixture();let stopped=false;
  try{await assert.rejects(()=>captureScan({...f,count:3,onProgress:p=>{if(p.stage==='capture'&&p.tiles===2)stopped=true;},checkStop:()=>{if(stopped)throw new Error('stopped');}}),/stopped/);
    const scan=[...f.metadata.values()][0];assert.equal(scan.status,'partial');assert.ok(scan.savedHeight>0&&scan.savedHeight<2868);assert.equal(f.v.scroller.scrollTop,250);assert.equal(scan.tiles.at(-1).y+scan.tiles.at(-1).height,scan.savedHeight);
  }finally{f.v.dispose();}
});
test('cut normalization and trims never introduce empty pages or cut beyond the saved scan',()=>{
  assert.deepEqual(normalizeCuts([500,0,500,-4,2000,100,NaN],1000),[0,100,500,1000]);assert.throws(()=>regularCuts(1000,0),/τουλάχιστον/);
  assert.deepEqual(splitRanges([0,500,1000],1000,{trimTop:10,trimBottom:20,excluded:[1]}),[{index:0,top:10,bottom:480}]);
});
test('a single lossless PNG can exceed 30000 pixels in height without creating a full-height canvas',async()=>{
  const scan={width:16,height:35050,savedHeight:35050,tiles:[]},tiles=new Map();
  for(let i=0;i<10;i++){const c=createCanvas(16,3505),ctx=c.getContext('2d');ctx.fillStyle=`rgb(${i+10},30,60)`;ctx.fillRect(0,0,16,3505);const tile={id:String(i),y:i*3505,width:16,height:3505,blob:imageBlob(c)};scan.tiles.push({id:tile.id,y:tile.y,width:16,height:tile.height});tiles.set(tile.id,tile);}
  const png=Buffer.from(await(await makeLongPNG(scan,id=>tiles.get(id))).arrayBuffer());assert.equal(png.readUInt32BE(20),35050);let pos=8;const compressed=[];
  while(pos<png.length){const n=png.readUInt32BE(pos),type=png.subarray(pos+4,pos+8).toString(),payload=png.subarray(pos+8,pos+8+n);assert.equal(png.readUInt32BE(pos+8+n),crc32(png.subarray(pos+4,pos+8+n)));if(type==='IDAT')compressed.push(payload);pos+=12+n;}
  const rows=inflateSync(Buffer.concat(compressed));assert.equal(rows.length,35050*(16*4+1));
  for(let i=0;i<10;i++){const row=i*3505*(16*4+1);assert.equal(rows[row],0);assert.deepEqual([...rows.subarray(row+1,row+5)],[i+10,30,60,255]);}
});
