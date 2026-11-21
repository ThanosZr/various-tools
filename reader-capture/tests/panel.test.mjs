// Executes the actual panel, bridge, content script, storage and exporters together.
// Browser geometry / chrome APIs are simulated; pixels use a native canvas implementation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {makeViewer,Element} from './viewer-fixture.mjs';
const require=createRequire(import.meta.url);
const {createCanvas,loadImage}=require(require.resolve('@napi-rs/canvas',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||process.cwd()]}));
const html=await readFile(new URL('../extension/panel.html',import.meta.url),'utf8');
const v=makeViewer(),nodes=new Map(),created=new Set(),stored=new Map(),downloads=[],panelListeners=new Set(),storageListeners=new Set();
class Node extends Element{
  constructor(tag){super(tag);this.value='';this.type='';this.checked=false;this.disabled=false;this.hidden=false;this.firstChild={textContent:''};created.add(this);this.classList={toggle:(name,force)=>{const set=new Set(this.className.split(' ').filter(Boolean));if(force===undefined?!set.has(name):force)set.add(name);else set.delete(name);this.className=[...set].join(' ');}};}
  setAttribute(name,value){this[name]=value;}
  replaceChildren(...els){this.children=[];this.append(...els);}
  showModal(){this.open=true;}
  close(){this.open=false;this.fire('close');}
  click(){if(!this.disabled)this.fire('click');}
}
for(const match of html.matchAll(/<([\w-]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)){
  const [,tag,attrs,id]=match,node=new Node(tag);node.id=id;
  for(const [key,value]of [...attrs.matchAll(/([\w-]+)="([^"]*)"/g)].map(x=>[x[1],x[2]]))node[key]=value;
  node.checked=/\bchecked\b/.test(attrs);node.disabled=/\bdisabled\b/.test(attrs);node.hidden=/\bhidden\b/.test(attrs);
  if(tag==='select'){const rest=html.slice(match.index+match[0].length).split('</select>')[0];node.value=rest.match(/<option value="([^"]+)"/)?.[1]||'';}
  nodes.set(id,node);
}
const $=id=>nodes.get(id),document=new Node('document');
document.getElementById=id=>$(id)||null;
document.querySelectorAll=selectors=>{const tags=selectors.split(',').map(s=>s.toUpperCase());return [...created].filter(n=>tags.includes(n.tagName));};
document.createElement=tag=>{
  if(tag==='canvas'){const canvas=createCanvas(1,1);canvas.toBlob=(cb,type,quality)=>cb(new Blob([canvas.toBuffer(type,type==='image/jpeg'?quality:undefined)],{type}));return canvas;}
  return new Node(tag);
};
globalThis.document=document;globalThis.window=new Node('window');
globalThis.createImageBitmap=async blob=>{const im=await loadImage(Buffer.from(await blob.arrayBuffer()));im.close=()=>{};return im;};
const local={settings:{mode:'manual',wait:'80'},settingsVersion:2},tab={id:7,windowId:1,active:true,url:'https://example.test/viewer',title:'Test viewer'};
const storageArea=data=>({get:async keys=>{const result={};for(const key of Array.isArray(keys)?keys:[keys])if(data[key]!==undefined)result[key]=data[key];return result;},set:async changes=>{Object.assign(data,changes);}});
const originals=Array.from({length:3},(_,i)=>{const c=createCanvas(660,940),ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,660,940);ctx.fillStyle=['#245c81','#238968','#ad6d22'][i];ctx.font='38px sans-serif';ctx.fillText('Page '+(i+1),40,95);for(let y=140;y<900;y+=23)ctx.fillRect(40,y,570,2);return c;});
globalThis.chrome={runtime:{id:'test',onMessage:{addListener:fn=>panelListeners.add(fn)},getURL:p=>p},
  tabs:{get:async()=>tab,query:async()=>[tab],create:async()=>{},sendMessage:async(id,message)=>{try{return {ok:true,data:await v.send(message.op,message)};}catch(e){return {ok:false,error:e.message,code:e.code};}},captureVisibleTab:async()=>{
    const c=createCanvas(1000,700),ctx=c.getContext('2d');ctx.fillStyle='#eee';ctx.fillRect(0,0,1000,700);
    for(let i=0;i<3;i++){const r=v.pages[i].getBoundingClientRect();ctx.drawImage(originals[i],r.x,r.y);}
    ctx.fillStyle='#eee';ctx.fillRect(0,0,1000,64);return 'data:image/png;base64,'+c.toBuffer('image/png').toString('base64');
  }},scripting:{executeScript:async()=>v.reinject()},storage:{local:storageArea(local),session:storageArea({target:tab}),onChanged:{addListener:fn=>storageListeners.add(fn)}},
  downloads:{onChanged:{addListener(){}},download:async({url,filename})=>{downloads.push({filename,blob:await(await fetch(url)).blob()});return downloads.length;}}
};
v.noticeHandlers.add(m=>{for(const fn of panelListeners)fn(m,{tab});});
globalThis.indexedDB={open:()=>{const req={result:{createObjectStore(){},transaction(){
  const tx={};const store={getAll:()=>({result:[...stored.values()]}),put:p=>{stored.set(p.id,p);return {result:p.id};},delete:id=>stored.delete(id),clear:()=>stored.clear()};tx.objectStore=()=>store;queueMicrotask(()=>tx.oncomplete?.());return tx;
}}};queueMicrotask(()=>{req.onupgradeneeded?.();req.onsuccess?.();});return req;}};
const originalTimeout=globalThis.setTimeout;
globalThis.setTimeout=(fn,ms,...args)=>{const timer=originalTimeout(fn,ms,...args);if(ms>10000)timer.unref();return timer;};
const until=async predicate=>{const deadline=Date.now()+15000;while(!predicate()){if(Date.now()>deadline)throw new Error('Panel timeout: '+$('status').textContent+' / '+$('errorText').textContent);await new Promise(r=>originalTimeout(r,15));}};
const click=async id=>{$(id).click();await until(()=>!$('capture').disabled);};

test('panel initializes, Draw really starts selection, N-page collection persists, PDF and ZIP export',async()=>{
  await import('../extension/panel.js');await until(()=>!$('capture').disabled);
  assert.equal($('errorDetails').hidden,true);await click('draw');assert.ok(v.overlay());
  v.overlay().surface.fire('pointerdown',{clientX:170,clientY:90});v.document.fire('pointermove',{clientX:830,clientY:699});v.tick(28);v.document.fire('pointerup',{clientX:830,clientY:1030-v.scroller.scrollTop});await v.flush();
  assert.equal(Number($('height').value),940);assert.equal($('mode').value,'manual');
  await click('measureGap');v.overlay().shadow.fire('wheel',{deltaY:900-v.scroller.scrollTop});v.overlay().surface.fire('pointerdown',{clientX:170,clientY:154});await v.flush();assert.match($('spacing').textContent,/964/);
  $('pageCount').value='3';await click('batchStart');assert.equal(stored.size,3);assert.equal(Number($('count').textContent),3);assert.match($('runStats').textContent,/3 λήψεις/);assert.equal($('errorDetails').hidden,true);
  assert.equal(v.scroller.scrollTop,900);assert.equal(local.settingsVersion,2);
  await click('pdf');assert.ok(downloads[0].filename.endsWith('.pdf'));assert.match(Buffer.from(await downloads[0].blob.arrayBuffer()).toString('latin1'),/\/Count 3/);
  await click('images');assert.ok(downloads[1].filename.endsWith('.zip'));assert.equal(new DataView(await downloads[1].blob.arrayBuffer()).getUint32(0,true),0x04034b50);
  v.dispose();
});
