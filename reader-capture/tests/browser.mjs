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
// TEST HARNESS ONLY: no toolbar gesture exists in Playwright's headless UI.
// Production package uses activeTab and has no host_permissions.
const manifest=JSON.parse(await readFile(path.join(ext,'manifest.json'),'utf8'));manifest.host_permissions=['<all_urls>'];await writeFile(path.join(ext,'manifest.json'),JSON.stringify(manifest));
let context;
const errors=[];
try{
  context=await chromium.launchPersistentContext(path.join(temp,'profile'),{executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,ignoreDefaultArgs:['--disable-extensions'],viewport:{width:1180,height:760},deviceScaleFactor:1,args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`,'--no-sandbox']});
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const id=new URL(worker.url()).host;
  const viewer=await context.newPage();await viewer.goto(`http://127.0.0.1:${port}/viewer.html`);
  const panel=await context.newPage();panel.on('pageerror',e=>errors.push(e.message));await panel.goto(`chrome-extension://${id}/panel.html`);
  await worker.evaluate(async url=>{const [tab]=await chrome.tabs.query({url});await chrome.storage.session.set({target:{id:tab.id,windowId:tab.windowId,url:tab.url,title:tab.title}});},viewer.url());
  await viewer.bringToFront();await panel.waitForFunction(()=>document.getElementById('source').textContent.includes('Demo viewer'));
  await panel.locator('#topInset').fill('64');await panel.locator('#wait').fill('80');
  async function click(id){await panel.evaluate(id=>document.getElementById(id).click(),id);}
  async function settled(){await panel.waitForFunction(()=>!document.getElementById('capture').disabled,{},{timeout:30000});}
  async function count(n){await panel.waitForFunction(n=>Number(document.getElementById('count').textContent)===n,n,{timeout:30000});}
  async function dbState(){return panel.evaluate(async()=>{const {allPages}=await import('./lib/db.js');return (await allPages()).sort((a,b)=>a.order-b.order).map(({blob,thumbnail,...p})=>({...p,size:blob.size}));});}
  async function saveOriginal(index,filename){const bytes=await panel.evaluate(async index=>{const {allPages}=await import('./lib/db.js');const p=(await allPages()).sort((a,b)=>a.order-b.order)[index];return Array.from(new Uint8Array(await p.blob.arrayBuffer()));},index);await writeFile(path.join(output,filename),Buffer.from(bytes));}
  await click('detect');await settled();assert.match(await panel.locator('#bounds').textContent(),/660 × 940/);
  await click('capture');await count(1);await settled();assert.equal(await viewer.evaluate(()=>scrollY),0);
  let records=await dbState();assert.equal(records[0].width,660);assert.equal(records[0].height,940);await saveOriginal(0,'capture-page1.png');
  await click('capture');await settled();assert.equal((await dbState()).length,1);assert.match(await panel.locator('#status').textContent(),/ήδη/);
  await click('next');await settled();await click('capture');await count(2);await settled();assert.equal((await dbState())[1].label,'2');
  await click('next');await settled();await click('capture');await count(3);await settled();assert.equal((await dbState())[2].label,'3');await saveOriginal(2,'capture-page3.png');
  // Browser-generated reference, with only the test viewer header hidden.
  await viewer.addStyleTag({content:'header{visibility:hidden!important}'});await viewer.locator('.page').first().screenshot({path:path.join(output,'reference-page1.png')});
  await viewer.evaluate(()=>document.querySelector('header').style.visibility='visible');
  // Exercise real PDF and ZIP downloads from the UI.
  const pdfDownload=panel.waitForEvent('download');await click('pdf');const pdf=await pdfDownload;await pdf.saveAs(path.join(output,'export.pdf'));await settled();
  const zipDownload=panel.waitForEvent('download');await click('images');const zip=await zipDownload;await zip.saveAs(path.join(output,'images.zip'));await settled();
  // Editor rotation + crop persists non-destructively.
  await panel.evaluate(()=>document.querySelector('.page-card .actions button').click());await settled();await panel.waitForFunction(()=>document.getElementById('editor').open);
  await click('rotate');await panel.waitForTimeout(200);await click('saveCrop');await settled();records=await dbState();assert.equal(records[0].rotation,90);assert.equal(records[0].width,660);
  // Backup then restore appends, retaining the existing collection.
  const backupDownload=panel.waitForEvent('download');await click('backup');const backup=await backupDownload;await backup.saveAs(path.join(output,'collection.rcap'));await settled();
  await panel.locator('#restoreFile').setInputFiles(path.join(output,'collection.rcap'));await count(6);await settled();
  // Verify state survives a panel reload.
  await panel.reload();await count(6);await viewer.bringToFront();
  // Nested scroller; no document scroll should be needed.
  await viewer.goto(`http://127.0.0.1:${port}/nested.html`);await worker.evaluate(async url=>{const [tab]=await chrome.tabs.query({url});await chrome.storage.session.set({target:{id:tab.id,windowId:tab.windowId,url:tab.url,title:tab.title}});},viewer.url());
  await panel.locator('#topInset').fill('0');await click('capture');await count(7);await settled();
  records=await dbState();assert.equal(records[6].width,600);assert.equal(records[6].height,950);assert.equal(await viewer.locator('.scroller').evaluate(el=>el.scrollTop),0);await saveOriginal(6,'nested-page1.png');
  await click('next');await settled();await click('capture');await count(8);await settled();assert.equal((await dbState())[7].label,'2');
  // Manual selection, repeated height and gap, and screenshot-only fallback.
  await viewer.goto(`http://127.0.0.1:${port}/viewer.html`);await worker.evaluate(async url=>{const [tab]=await chrome.tabs.query({url});await chrome.storage.session.set({target:{id:tab.id,windowId:tab.windowId,url:tab.url,title:tab.title}});},viewer.url());
  await click('draw');await settled();await viewer.mouse.move(260,90);await viewer.mouse.down();await viewer.mouse.move(920,700);await viewer.mouse.up();
  await panel.waitForFunction(()=>document.getElementById('mode').value==='manual');await panel.locator('#height').fill('940');await panel.locator('#gap').fill('24');await panel.locator('#topInset').fill('64');await click('applyGeometry');await settled();
  await click('capture');await settled(); // duplicate of page 1 may be skipped
  await click('next');await settled();await click('visible');await settled();records=await dbState();assert.ok(records.at(-1).snippet);
  await panel.screenshot({path:path.join(output,'panel.png'),fullPage:true});
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,pages:records.length,checks:['document stitching','clamped bottom','scroll restoration','duplicate detection','navigation','PDF download','ZIP download','rotation','backup / restore','persistence','nested scroller','manual calibration','visible snippet'],pageErrors:errors},null,2));
}finally{await context?.close();await new Promise(r=>server.close(r));await rm(temp,{recursive:true,force:true});}
