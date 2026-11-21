import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {intersection,tileSlice,outputSize,pageBox,safeName} from '../extension/lib/geometry.js';
import {makePDF} from '../extension/lib/pdf.js';
import {makeZIP,crc32} from '../extension/lib/zip.js';

test('stitching covers all rows once at start, middle and clamped bottom',()=>{
  const height=1400, viewport={x:0,y:64,width:1000,height:600};let covered=0,total=0;
  for(const y of [88,-480,-736]){const s=tileSlice({x:120,y,width:660,height},viewport,covered);assert.equal(s.dy,covered);total+=s.sh;covered=s.end;}
  assert.equal(covered,height);assert.equal(total,height);
});
test('stitching rejects missing rows and horizontal cropping',()=>{
  assert.throws(()=>tileSlice({x:0,y:-200,width:600,height:1000},{x:0,y:70,width:900,height:600},100),/κενό/);
  assert.throws(()=>tileSlice({x:-20,y:0,width:600,height:1000},{x:0,y:0,width:900,height:600},0),/οριζόντια/);
});
test('downsampling never upscales and enforces canvas limits',()=>{
  assert.equal(outputSize(600,1000,1600).scale,1);
  const size=outputSize(12000,20000,0);assert.ok(size.width*size.height<=40010000);assert.ok(size.width<=30000&&size.height<=30000);
  assert.deepEqual(intersection({x:0,y:0,width:5,height:5},{x:3,y:3,width:4,height:4}),{x:3,y:3,width:2,height:2});
});
test('PDF media boxes preserve image aspect and orient landscape',()=>{
  const box=pageBox(1200,800,'a4');assert.ok(box.width>box.height);assert.equal(box.drawWidth/box.drawHeight,1.5);
  assert.equal(pageBox(600,900,'original').width,450);
});
test('ZIP CRC matches a published standard check vector',()=>assert.equal(crc32(new TextEncoder().encode('123456789')),0xcbf43926));
test('ZIP has UTF-8 entries with valid offsets and CRC',async()=>{
  const b=await makeZIP([{name:'δοκιμή.txt',blob:new Blob(['hello'])},{name:'second.txt',blob:new Blob(['world'])}]);
  const a=new Uint8Array(await b.arrayBuffer()), v=new DataView(a.buffer);assert.equal(v.getUint32(0,true),0x04034b50);assert.equal(v.getUint16(6,true),0x800);assert.equal(v.getUint32(a.length-22,true),0x06054b50);assert.equal(v.getUint16(a.length-12,true),2);
  await mkdir('test-output',{recursive:true});await writeFile('test-output/core.zip',a);
});
test('PDF object and xref offsets are byte-accurate, including Greek metadata',async()=>{
  const jpeg=new Blob([new Uint8Array([255,216,255,217])],{type:'image/jpeg'});
  const blob=await makePDF([{blob:jpeg,width:100,height:200},{blob:jpeg,width:200,height:100}],{title:'Δοκιμή'});
  const bytes=new Uint8Array(await blob.arrayBuffer()),s=Buffer.from(bytes).toString('latin1');
  const offset=Number(s.match(/startxref\n(\d+)/)[1]);assert.equal(s.slice(offset,offset+4),'xref');
  const xref=s.slice(offset).split('\n');const count=Number(xref[1].split(' ')[1]);
  for(let i=1;i<count;i++){const start=Number(xref[2+i].slice(0,10));assert.ok(s.slice(start).startsWith(`${i} 0 obj`));}
  assert.match(s,/\/Count 2/);assert.match(s,/FEFF0394/);assert.ok(safeName('a/b:c')==='a_b_c');
  await assert.rejects(()=>makePDF([]));
});
