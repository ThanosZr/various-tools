import {createServer} from 'node:http';
import {readFile,mkdir,cp,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(require.resolve('playwright',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||process.cwd()]}));
const {loadImage,createCanvas}=require(require.resolve('@napi-rs/canvas',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||process.cwd()]}));
const BASELINE='0bf19325fe1509076c693e495cfc9c3ae9c7b7e5';
const root=path.resolve('.'),temp=await mkdtemp(path.join(tmpdir(),'readercapture-benchmark-')),output=path.join(root,'test-output');await mkdir(output,{recursive:true});
const server=createServer(async(req,res)=>{try{const file=path.resolve(root,'demo','.'+(req.url==='/'?'/viewer.html':req.url));if(!file.startsWith(path.join(root,'demo')+path.sep))throw new Error();res.setHeader('Content-Type','text/html; charset=utf-8');res.end(await readFile(file));}catch{res.statusCode=404;res.end('not found');}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}/viewer.html`;
async function baselineDirectory(){
  if(process.env.READERCAPTURE_BASELINE_DIR)return path.resolve(process.env.READERCAPTURE_BASELINE_DIR);
  const destination=path.join(temp,'baseline');await mkdir(destination);
  const archive=execFileSync('git',['archive',BASELINE,'reader-capture'],{cwd:root,maxBuffer:16000000});
  execFileSync('tar',['-x','-C',destination],{input:archive});return path.join(destination,'reader-capture');
}
async function measure(label,directory){
  const ext=path.join(temp,label,'extension');await cp(path.join(directory,'extension'),ext,{recursive:true});
  const manifest=JSON.parse(await readFile(path.join(ext,'manifest.json'),'utf8'));manifest.host_permissions=['<all_urls>'];await writeFile(path.join(ext,'manifest.json'),JSON.stringify(manifest));
  // Timing instrumentation changes neither the chosen delays nor capture paths.
  const file=path.join(ext,'content.js'),source=await readFile(file,'utf8'),needle='const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));';assert.ok(source.includes(needle));
  await writeFile(file,source.replace(needle,'const wait=ms=>new Promise(resolve=>{const start=performance.now();globalThis.__rcScheduled=(globalThis.__rcScheduled||0)+ms;setTimeout(()=>{globalThis.__rcWait=(globalThis.__rcWait||0)+performance.now()-start;resolve();},ms);});'));
  const panelFile=path.join(ext,'panel.js'),panelSource=await readFile(panelFile,'utf8');assert.ok(panelSource.includes('async function screenshot(t){'));
  await writeFile(panelFile,panelSource.replace('async function screenshot(t){','async function screenshot(t){globalThis.__rcFrames=(globalThis.__rcFrames||0)+1;'));
  let context;const errors=[];
  try{
    context=await chromium.launchPersistentContext(path.join(temp,label,'profile'),{executablePath:process.env.CHROMIUM_PATH||chromium.executablePath(),headless:true,ignoreDefaultArgs:['--disable-extensions'],viewport:{width:1180,height:760},deviceScaleFactor:1,args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`,'--no-sandbox']});
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:30000}),id=new URL(worker.url()).host;
    const viewer=await context.newPage();await viewer.goto(url);
    await viewer.evaluate(()=>{
      const wrapper=document.createElement('div');Object.assign(wrapper.style,{position:'fixed',inset:'0',zIndex:'100',pointerEvents:'none'});
      const band=document.createElement('div');Object.assign(band.style,{position:'absolute',left:'0',right:'0',top:'360px',height:'34px',background:'#00ff00'});wrapper.append(band);document.body.append(wrapper);
      const scripted=document.createElement('div');Object.assign(scripted.style,{position:'absolute',left:'0',right:'0',height:'26px',background:'#ff00ff',pointerEvents:'none',zIndex:'101'});
      const place=()=>scripted.style.top=(scrollY+520)+'px';place();document.addEventListener('scroll',place);document.body.append(scripted);
    });
    const panel=await context.newPage();panel.on('pageerror',e=>errors.push(e.message));await panel.goto(`chrome-extension://${id}/panel.html`);
    await worker.evaluate(async url=>{const [t]=await chrome.tabs.query({url});await chrome.storage.session.set({target:{id:t.id,windowId:t.windowId,url:t.url,title:t.title}});},url);
    await viewer.bringToFront();await panel.waitForFunction(()=>!document.getElementById('capture').disabled);
    const click=async id=>panel.evaluate(id=>document.getElementById(id).click(),id);
    const settled=async()=>{await panel.waitForFunction(()=>!document.getElementById('capture').disabled,{}, {timeout:120000});assert.equal(await panel.locator('#errorDetails').isVisible(),false,await panel.locator('#errorText').textContent());};
    await click('detect');await settled();await panel.locator('#walkCount').fill('3');await panel.locator('#walkStep').fill('140');
    // Default 450ms is the same setting in both versions. The 0.4 fast path
    // treats it as a stability deadline; 0.3 sleeps for all 450ms each time.
    await viewer.bringToFront();const popupEvent=context.waitForEvent('page',{timeout:120000}),start=performance.now();await click('scanStart');await settled();
    const popup=await popupEvent;await popup.waitForURL(/splitter\.html/);await popup.locator('#scanInfo').filter({hasText:'660 × 2820'}).waitFor({timeout:30000});
    const elapsedMs=performance.now()-start;
    const pages=await popup.evaluate(async()=>{const {getScan,getTile}=await import('./lib/scan-store.js'),{renderScanRegion}=await import('./lib/split.js');const s=await getScan(new URL(location.href).searchParams.get('scan'));if(s.pages.length!==3)throw new Error('Wrong page count');const images=[];for(const p of s.pages){const r=await renderScanRegion(s,p,getTile,{type:'image/png'});images.push(Array.from(new Uint8Array(await r.blob.arrayBuffer())));}return images;});
    const waits=await worker.evaluate(async url=>{const [t]=await chrome.tabs.query({url});const [r]=await chrome.scripting.executeScript({target:{tabId:t.id},func:()=>({actual:globalThis.__rcWait||0,scheduled:globalThis.__rcScheduled||0})});return r.result;},url);
    const frames=await panel.evaluate(()=>globalThis.__rcFrames||0);assert.deepEqual(errors,[]);
    return {version:manifest.version_name||manifest.version,elapsedMs:Math.round(elapsedMs),frames,scrollAndSettleMs:Math.round(waits.actual),scheduledWaitMs:waits.scheduled,pages};
  }finally{await context?.close();}
}
try{
  const baseline=await measure('baseline',await baselineDirectory()),current=await measure('current',root);
  for(let i=0;i<3;i++){
    const a=await loadImage(Buffer.from(baseline.pages[i])),b=await loadImage(Buffer.from(current.pages[i]));assert.equal(a.width,b.width);assert.equal(a.height,b.height);
    const c=createCanvas(a.width,a.height),ctx=c.getContext('2d');ctx.drawImage(a,0,0);const before=Buffer.from(ctx.getImageData(0,0,a.width,a.height).data);ctx.clearRect(0,0,a.width,a.height);ctx.drawImage(b,0,0);const after=Buffer.from(ctx.getImageData(0,0,a.width,a.height).data);assert.ok(before.equals(after),`Page ${i+1} differs from the verified 0.3 output`);
  }
  const {pages:oldPages,...oldStats}=baseline,{pages:newPages,...newStats}=current;
  const result={baselineCommit:BASELINE,fixture:'3 pages, 660 × 940 CSS px, fixed wrapper + scripted floating bar, 1180 × 760 viewport, default 450 ms wait',baseline:oldStats,current:newStats,speedup:{total:baseline.elapsedMs/current.elapsedMs,scrollAndSettle:baseline.scrollAndSettleMs/current.scrollAndSettleMs,scheduledWait:baseline.scheduledWaitMs/current.scheduledWaitMs},pixelEquality:true};
  await writeFile(path.join(output,'benchmark.json'),JSON.stringify(result,null,2));console.log('READERCAPTURE_BENCHMARK '+JSON.stringify(result));
  assert.ok(current.elapsedMs<baseline.elapsedMs*.85,'fast capture must improve real elapsed time');assert.ok(result.speedup.scheduledWait>=10,'scroll scheduling target is at least 10×');assert.ok(current.frames<=baseline.frames,'fast mode must not take more screenshots');
}finally{await new Promise(resolve=>server.close(resolve));await rm(temp,{recursive:true,force:true});}
