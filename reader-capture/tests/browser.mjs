import {createServer} from 'node:http';
import {readFile,mkdir,cp,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(require.resolve('playwright',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||process.cwd()]}));
const root=path.resolve('.'),output=path.join(root,'test-output');await mkdir(output,{recursive:true});
const server=createServer(async(req,res)=>{try{const file=path.resolve(root,'demo','.'+(req.url==='/'?'/viewer.html':req.url));if(!file.startsWith(path.join(root,'demo')+path.sep))throw new Error();res.setHeader('Content-Type','text/html; charset=utf-8');res.end(await readFile(file));}catch{res.statusCode=404;res.end('not found');}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
const temp=await mkdtemp(path.join(tmpdir(),'readercapture-test-')),ext=path.join(temp,'extension');await cp(path.join(root,'extension'),ext,{recursive:true});
// Test-only host access substitutes for a physical toolbar gesture. Production uses activeTab.
const manifest=JSON.parse(await readFile(path.join(ext,'manifest.json'),'utf8'));manifest.host_permissions=['<all_urls>'];await writeFile(path.join(ext,'manifest.json'),JSON.stringify(manifest));
let context;const errors=[];
try{
 context=await chromium.launchPersistentContext(path.join(temp,'profile'),{executablePath:process.env.CHROMIUM_PATH||chromium.executablePath(),headless:true,ignoreDefaultArgs:['--disable-extensions'],viewport:{width:1180,height:760},deviceScaleFactor:1,args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`,'--no-sandbox']});
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const id=new URL(worker.url()).host;
 const viewer=await context.newPage();await viewer.goto(`http://127.0.0.1:${port}/viewer.html`);
 // A toolbar in the middle of the viewport reproduces the reported seam artifact.
 await viewer.evaluate(()=>{const e=document.createElement('div');e.className='test-toolbar';e.setAttribute('role','toolbar');Object.assign(e.style,{position:'fixed',left:'0',right:'0',top:'360px',height:'34px',zIndex:'100',background:'#00ff00'});e.textContent='Persistent toolbar';document.body.append(e);});
 const panel=await context.newPage();panel.on('pageerror',e=>errors.push(e.message));await panel.goto(`chrome-extension://${id}/panel.html`);
 await worker.evaluate(async url=>{const [tab]=await chrome.tabs.query({url});await chrome.storage.session.set({target:{id:tab.id,windowId:tab.windowId,url:tab.url,title:tab.title}});},viewer.url());
 await viewer.bringToFront();await panel.waitForFunction(()=>!document.getElementById('capture').disabled);
 async function click(id){await panel.evaluate(id=>document.getElementById(id).click(),id);}
 async function fill(id,value){await panel.evaluate(id=>{for(let p=document.getElementById(id).parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;},id);await panel.locator('#'+id).fill(value);}
 async function settled(){await panel.waitForFunction(()=>!document.getElementById('capture').disabled,{}, {timeout:60000});const error=await panel.locator('#errorText').textContent();assert.equal(await panel.locator('#errorDetails').isVisible(),false,error);}
 await fill('wait','100');await click('draw');await settled();
 const initial=await viewer.locator('.page').first().boundingBox();await viewer.mouse.move(initial.x,initial.y);await viewer.mouse.down();await viewer.mouse.move(initial.x+initial.width,748);await viewer.waitForTimeout(500);
 assert.ok(await viewer.evaluate(()=>scrollY)>0,'dragging at the edge scrolls');
 let visible=await viewer.locator('.page').first().boundingBox();if(visible.y+visible.height>730){await viewer.mouse.wheel(0,300);await viewer.waitForTimeout(150);visible=await viewer.locator('.page').first().boundingBox();}
 await viewer.mouse.move(visible.x+visible.width,visible.y+visible.height);await viewer.mouse.up();await panel.waitForFunction(()=>Number(document.getElementById('height').value)>900);
 await click('measureGap');await settled();await viewer.mouse.wheel(0,700);await viewer.waitForTimeout(200);
 const second=await viewer.locator('.page').nth(1).boundingBox();if(second.y<80||second.y>700){await viewer.mouse.wheel(0,second.y-170);await viewer.waitForTimeout(200);}
 const next=await viewer.locator('.page').nth(1).boundingBox();await viewer.mouse.click(next.x+5,next.y);await panel.waitForFunction(()=>document.getElementById('spacing').textContent.includes('964'));
 // Actual Chrome zoom should not invalidate the calibrated rectangle.
 await worker.evaluate(async url=>{const [t]=await chrome.tabs.query({url});await chrome.tabs.setZoom(t.id,.8);},viewer.url());await viewer.waitForTimeout(250);
 const selection=await worker.evaluate(async url=>{const [t]=await chrome.tabs.query({url});return chrome.tabs.sendMessage(t.id,{scope:'readercapture',op:'selection'});},viewer.url());assert.equal(Math.round(selection.data.rect.width),660);assert.equal(Math.round(selection.data.rect.height),940);
 await worker.evaluate(async url=>{const [t]=await chrome.tabs.query({url});await chrome.tabs.setZoom(t.id,1);},viewer.url());await viewer.waitForTimeout(250);
 await panel.locator('#rangeMode').selectOption('repeat');await fill('pageCount','3');await viewer.bringToFront();
 const popupEvent=context.waitForEvent('page');await click('scanStart');const popup=await popupEvent;await popup.waitForURL(/splitter\.html/);popup.on('pageerror',e=>errors.push(e.message));await popup.locator('#scanInfo').filter({hasText:'660 × 2868'}).waitFor({timeout:60000});await settled();
 const metadata=await popup.evaluate(async()=>{const {getScan}=await import('./lib/scan-store.js');return getScan(new URL(location.href).searchParams.get('scan'));});assert.equal(metadata.status,'complete');assert.equal(metadata.savedHeight,2868);assert.equal(metadata.width,660);
 // Export a page from the stored strip and compare with a clean browser-rendered page.
 const actual=await popup.evaluate(async()=>{const {getScan,getTile}=await import('./lib/scan-store.js'),{renderScanRegion}=await import('./lib/split.js');const scan=await getScan(new URL(location.href).searchParams.get('scan'));const result=await renderScanRegion(scan,{top:0,bottom:940},getTile,{type:'image/png'});return Array.from(new Uint8Array(await result.blob.arrayBuffer()));});await writeFile(path.join(output,'strip-page1.png'),Buffer.from(actual));
 await viewer.addStyleTag({content:'header,.test-toolbar,[data-readercapture]{visibility:hidden!important}'});await viewer.locator('.page').first().screenshot({path:path.join(output,'reference-page1.png')});
 const {loadImage,createCanvas}=require(require.resolve('@napi-rs/canvas',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||process.cwd()]}));
 const a=await loadImage(Buffer.from(actual)),b=await loadImage(await readFile(path.join(output,'reference-page1.png')));assert.equal(a.width,b.width);assert.equal(a.height,b.height);const c=createCanvas(a.width,a.height),ctx=c.getContext('2d');ctx.drawImage(a,0,0);const pixelsA=Buffer.from(ctx.getImageData(0,0,a.width,a.height).data);ctx.clearRect(0,0,a.width,a.height);ctx.drawImage(b,0,0);const pixelsB=Buffer.from(ctx.getImageData(0,0,b.width,b.height).data);assert.ok(pixelsA.equals(pixelsB),'captured page matches reference pixels, including areas behind toolbars');
 const before=await viewer.evaluate(()=>scrollY);await popup.locator('#pageHeight').fill('940');await popup.locator('#pageGap').fill('24');await popup.locator('#regular').click();assert.match(await popup.locator('#pageCount').textContent(),/3 σελίδες/);
 const pdfEvent=popup.waitForEvent('download');await popup.locator('#exportPdf').click();const pdf=await pdfEvent;await pdf.saveAs(path.join(output,'split-export.pdf'));assert.equal(await viewer.evaluate(()=>scrollY),before,'export does not scroll source tab');
 const pngEvent=popup.waitForEvent('download');await popup.locator('#exportPng').click();const png=await pngEvent;await png.saveAs(path.join(output,'long.png'));const pngBytes=await readFile(path.join(output,'long.png'));assert.equal(pngBytes.readUInt32BE(16),660);assert.equal(pngBytes.readUInt32BE(20),2868);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks:['real pointer drawing','edge scrolling','visual spacing','Chrome zoom','persistent toolbar removal','continuous capture','popup splitter','pixel equality','PDF export without source scrolling','single PNG export'],pageErrors:errors},null,2));
}finally{await context?.close();await new Promise(r=>server.close(r));await rm(temp,{recursive:true,force:true});}
