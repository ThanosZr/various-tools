import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tileSlice} from '../extension/lib/geometry.js';
import {makePDF} from '../extension/lib/pdf.js';
import {makeZIP} from '../extension/lib/zip.js';
const require=createRequire(import.meta.url);
const canvasLib=require(require.resolve('@napi-rs/canvas',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||process.cwd()]}));
const {createCanvas,loadImage}=canvasLib;
import {makeViewer} from './viewer-fixture.mjs';
test('automatic DOM bounds and one-page navigation work with document and nested scrolling',async()=>{
  for(const nested of [false,true]){
    const v=makeViewer(nested);const m=await v.send('inspect');assert.equal(m.label,'1');assert.equal(m.rect.height,940);
    await v.send('next',{direction:1});assert.equal((await v.send('inspect')).label,'2');
    await v.send('next',{direction:-1});assert.equal((await v.send('inspect')).label,'1');
  }
});
test('capture transaction restores scroll on completion and user interruption',async()=>{
  const v=makeViewer(true);v.scroller.scrollTop=25;
  await v.send('begin');await v.send('move',{covered:0});assert.notEqual(v.scroller.scrollTop,25);
  await v.send('end');assert.equal(v.scroller.scrollTop,25);
  await v.send('begin');v.events.wheel();await assert.rejects(()=>v.send('metrics'),{code:'USER_INTERRUPTED'});await v.send('end');assert.equal(v.scroller.scrollTop,25);v.dispose();
});
test('capture rejects reflow and a resized viewport',async()=>{
  const v=makeViewer();await v.send('begin');const saved=v.pages[0].getBoundingClientRect;v.pages[0].getBoundingClientRect=()=>({...saved(),height:950});
  await assert.rejects(()=>v.send('metrics'),/διάταξη/);await v.send('end');v.pages[0].getBoundingClientRect=saved;
  await v.send('begin');v.ctx.innerWidth=900;await assert.rejects(()=>v.send('metrics'),{code:'VIEWPORT_CHANGED'});await v.send('end');v.dispose();
});
test('manual calibration repeats the chosen width, height and gap',async()=>{
  const v=makeViewer();await v.draw();
  await v.send('set-geometry',{values:{width:660,height:940,gap:24}});
  const opts={mode:'manual',wait:80,topInset:64};
  let m=await v.send('inspect',{opts});assert.equal(m.rect.y,90);assert.equal(m.rect.height,940);
  await v.send('next',{opts,direction:1});m=await v.send('inspect',{opts});assert.equal(m.label,'2');assert.equal(m.rect.y,88);v.dispose();
});
function originalPage(index,scale){
  const c=createCanvas(660*scale,940*scale),ctx=c.getContext('2d');ctx.scale(scale,scale);ctx.fillStyle='white';ctx.fillRect(0,0,660,940);
  ctx.fillStyle=['#123f5f','#128b68','#b57a13'][index];ctx.fillRect(25,25,610,18);ctx.font='30px sans-serif';ctx.fillText('ReaderCapture / '+(index+1),35,100);
  for(let y=130;y<900;y+=17){ctx.fillStyle=y%2?'#0a5239':'#264881';ctx.fillRect(38,y,580,3);ctx.font='10px sans-serif';ctx.fillText(String(y),38,y+13);}
  ctx.fillStyle='#e24777';ctx.fillRect(0,930,660,10);return c;
}
test('pixel-perfect stitching at DPR 1 and 2, nested scrolling and clamped final page; valid PDF/ZIP artifacts',async()=>{
  await mkdir('test-output',{recursive:true});const pdfPages=[];
  for(const nested of [false,true])for(const scale of [1,2]){
    const v=makeViewer(nested),originals=v.pages.map((_,i)=>originalPage(i,scale));
    for(let pageIndex=0;pageIndex<v.pages.length;pageIndex++){
      if(pageIndex)await v.send('next',{direction:1});
      const initialScroll=v.scroller.scrollTop,start=await v.send('begin'),canvas=createCanvas(660*scale,940*scale),draw=canvas.getContext('2d');let covered=0;
      try{
        while(covered<940){
          const m=await v.send('move',{covered});const slice=tileSlice(m.rect,m.clip,covered);assert.ok(slice);
          const shot=createCanvas(1000*scale,700*scale),s=shot.getContext('2d');s.fillStyle='#888';s.fillRect(0,0,shot.width,shot.height);
          s.save();s.beginPath();s.rect(m.clip.x*scale,m.clip.y*scale,m.clip.width*scale,m.clip.height*scale);s.clip();
          for(let i=0;i<v.pages.length;i++){const r=v.pages[i].getBoundingClientRect();s.drawImage(originals[i],r.x*scale,r.y*scale);}s.restore();
          draw.drawImage(shot,slice.sx*scale,slice.sy*scale,slice.sw*scale,slice.sh*scale,0,slice.dy*scale,660*scale,slice.sh*scale);covered=slice.end;
        }
      }finally{await v.send('end');}
      assert.equal(v.scroller.scrollTop,initialScroll);
      const actual=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data,expected=originals[pageIndex].getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
      assert.deepEqual(Buffer.from(actual),Buffer.from(expected));
      if(!nested&&scale===1){await writeFile(`test-output/stitched-${pageIndex+1}.png`,canvas.toBuffer('image/png'));pdfPages.push({blob:new Blob([canvas.toBuffer('image/jpeg')],{type:'image/jpeg'}),width:canvas.width,height:canvas.height});}
    }
  }
  const pdf=await makePDF(pdfPages,{size:'a4',title:'Δοκιμή συρραφής'});await writeFile('test-output/validated.pdf',Buffer.from(await pdf.arrayBuffer()));
  const zip=await makeZIP(pdfPages.map((p,i)=>({name:`Σελίδα-${i+1}.jpg`,blob:p.blob})));await writeFile('test-output/validated.zip',Buffer.from(await zip.arrayBuffer()));
});

// Test the actual browser image processing module against a canvas-compatible adapter.
globalThis.document={createElement:()=>{const c=createCanvas(1,1);c.toBlob=(cb,type,quality)=>cb(new Blob([c.toBuffer(type,type==='image/jpeg'?quality:undefined)],{type}));return c;}};
globalThis.createImageBitmap=async blob=>{const im=await loadImage(Buffer.from(await blob.arrayBuffer()));im.close=()=>{};return im;};
const {renderPage}=await import('../extension/lib/image.js');
test('real image transforms rotate, crop, downsample and reduce exported size',async()=>{
  const original=originalPage(0,2),blob=new Blob([original.toBuffer('image/png')],{type:'image/png'}),page={blob,width:1320,height:1880};
  const rotated=await renderPage({...page,rotation:90},{type:'image/png'});assert.equal(rotated.width,1880);assert.equal(rotated.height,1320);
  const cropped=await renderPage({...page,crop:{x:10,y:20,width:800,height:1000}},{maxWidth:400,type:'image/png'});assert.equal(cropped.width,400);assert.equal(cropped.height,500);
  const full=await renderPage(page,{quality:.95}),small=await renderPage(page,{quality:.72,maxWidth:600,grayscale:true});assert.ok(small.blob.size<full.blob.size/2);
});
