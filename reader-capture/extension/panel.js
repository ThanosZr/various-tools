import {intersection,tileSlice,outputSize,safeName} from './lib/geometry.js';
import {makePDF} from './lib/pdf.js';
import {makeZIP} from './lib/zip.js';
import {allPages,putPage,deletePage,clearPages,replacePages} from './lib/db.js';
import {canvasBlob,renderPage,thumb,hashBlob,blobDataURL} from './lib/image.js';
import {PageBridge,friendlyError} from './lib/bridge.js';
import {runBatch} from './lib/batch.js';
import {captureScan} from './lib/scan-capture.js';
import {getScan,listScans} from './lib/scan-store.js';

const $=id=>document.getElementById(id);
const settingsIds=['mode','width','height','gap','topInset','bottomInset','wait','title','preset','maxWidth','quality','paper','imageFormat','grayscale','overlap','lockRatio','edgeSpeed','batchMode','startPage','pageCount','autoExport','returnPosition','rangeMode','autoExcludeBars','scanFirst','scanCount'];
const bridge=new PageBridge();
let pages=[],target=null,busy=false,stopped=false,lastCapture=0,urls=[],selected=new Set(),saveTimer,selectionState=null,batchRunning=false,paused=false,lastScanId=null;
const mb=n=>(n/1024/1024).toFixed(2)+' MB';
function status(text,error=false){$('status').textContent=text;$('status').classList.toggle('error',error);}
function opts(){return {...Object.fromEntries(['mode','topInset','bottomInset','wait','rangeMode'].map(id=>[id,$(id).value])),lockRatio:$('lockRatio').checked,edgeSpeed:Number($('edgeSpeed').value),autoExcludeBars:$('autoExcludeBars').checked,returnPosition:$('returnPosition').checked};}
function config(){return {maxWidth:Number($('maxWidth').value)||0,quality:Number($('quality').value)/100,grayscale:$('grayscale').checked};}
function selectedPages(){return pages.filter(p=>!selected.size||selected.has(p.id));}
async function saveSettings(){try{const s={};for(const id of settingsIds){const el=$(id);if(el)s[id]=el.type==='checkbox'?el.checked:el.value;}await chrome.storage.local.set({settings:s,settingsVersion:3});}catch(e){reportError(e);}}
function reportError(e){const partial=e.batch?` Κρατήθηκαν ${e.batch.added} σελίδες.`:'';status(friendlyError(e)+partial,true);$('errorDetails').hidden=false;$('errorText').textContent=`${e.code||'ERROR'}: ${e.message||e}\n${e.stack||''}`;}
function setBusy(value){busy=value;for(const el of document.querySelectorAll('button,input,select'))el.disabled=value;$('cancel').disabled=!value;$('scanCancel').disabled=!value;$('pause').disabled=!batchRunning;$('copyError').disabled=false;$('progress').hidden=!value;if(!value){$('progress').value=0;$('scanProgress').hidden=true;$('pause').disabled=true;}}
async function task(fn){if(busy)return;stopped=false;try{setBusy(true);$('errorDetails').hidden=true;await fn();}catch(e){reportError(e);}finally{setBusy(false);}}
function checkStop(){if(stopped)throw Object.assign(new Error('Η ενέργεια διακόπηκε. Οι ολοκληρωμένες σελίδες διατηρήθηκαν.'),{code:'STOPPED'});}
function source(){ $('source').textContent=target?`${target.title||'Έγγραφο'}\n${target.url||''}`:'Πάτησε το εικονίδιο της επέκτασης στο έγγραφο.'; }
async function ensure(t=target){
  const resolved=await bridge.ensure(t);if(!target||t===target||target.id===t?.id){target=resolved;source();}return resolved;
}
async function command(op,extra={},t=target){
  return bridge.call(op,{opts:opts(),...extra},t);
}
function showBounds(m){
  $('bounds').textContent=`${Math.round(m.rect.width)} × ${Math.round(m.rect.height)} px${m.label?' · Σελίδα '+m.label:''} · ${m.kind==='manual'?'δική σου περιοχή':'εντοπίστηκε'}`;
  if(m.step!==undefined){selectionState=m;$('mode').value='manual';$('width').value=Number(m.rect.width.toFixed(2));$('height').value=Number(m.rect.height.toFixed(2));$('gap').value=Number(m.gap.toFixed(2));$('spacing').textContent=m.calibrated?`Βήμα ${Math.round(m.step)} px · διάκενο ${Math.round(m.gap)} px · έτοιμο για αυτόματη λήψη.`:'Όρισε την αρχή της επόμενης σελίδας για να μετρηθεί το βήμα.';$('bounds').textContent+=m.tracking==='page'?' · αναλογίες δεμένες με τη σελίδα':m.tracking==='cached'?' · αποθηκευμένη γεωμετρία':' · σταθερές διαστάσεις CSS';}
}
async function screenshot(t){
  // captureVisibleTab uses the ACTIVE tab, so check both sides of each call.
  const verify=async()=>{const [tab]=await chrome.tabs.query({active:true,windowId:t.windowId});if(tab?.id!==t.id)throw new Error('Άλλαξε η ενεργή καρτέλα. Η λήψη ακυρώθηκε.');};
  await verify();checkStop();
  await new Promise(r=>setTimeout(r,Math.max(0,650-(Date.now()-lastCapture))));
  await verify();checkStop();lastCapture=Date.now();
  const data=await chrome.tabs.captureVisibleTab(t.windowId,{format:'png'});
  await verify();checkStop();return createImageBitmap(await (await fetch(data)).blob());
}
async function addPage(blob,width,height,meta={}){
  const hash=await hashBlob(blob);
  const existing=pages.find(p=>p.hash===hash&&p.sourceUrl===meta.sourceUrl&&p.label===(meta.label||'')&&!!p.snippet===!!meta.snippet);if(existing){if(!batchRunning)status('Αυτή η ίδια σελίδα υπάρχει ήδη στη συλλογή.');return {added:false,id:existing.id};}
  const order=pages.length?Math.max(...pages.map(p=>p.order))+1:0;
  const p={id:crypto.randomUUID(),order,blob,width,height,rotation:0,crop:null,hash,created:new Date().toISOString(),...meta};
  p.thumbnail=await thumb(p);await putPage(p);pages.push(p);await renderList();
  if(pages.length===1 && $('title').value==='Το έγγραφό μου'){$('title').value=safeName(meta.sourceTitle||'Το έγγραφό μου');await saveSettings();}
  return {added:true,id:p.id};
}
async function capturePage(onlyVisible=false,{index,batch=false,target:forced,onTile=()=>{}}={}){
  const t=forced||await ensure();checkStop();const operationOpts={...opts(),...(Number.isInteger(index)?{mode:'manual',index}:{})};
  let started=false,ctx,canvas,covered=0,m;
  try{
    m=await command('begin',{opts:operationOpts},t);started=true;
    const expectedUrl=m.url, initial={...m.rect};showBounds(m);
    if(onlyVisible){
      const top=Math.max(m.clip.y,Number($('topInset').value)||0), bottom=Math.min(m.clip.y+m.clip.height,m.viewport.height-(Number($('bottomInset').value)||0));
      m.clip={...m.clip,y:top,height:Math.max(0,bottom-top)};
      const r=intersection(m.rect,m.clip);if(r.width<10||r.height<10)throw new Error('Η επιλεγμένη περιοχή δεν είναι ορατή.');
      const img=await screenshot(t);
      try{
        const sx=img.width/m.viewport.width, sy=img.height/m.viewport.height, size=outputSize(r.width*sx,r.height*sy,0);
        canvas=document.createElement('canvas');canvas.width=size.width;canvas.height=size.height;ctx=canvas.getContext('2d',{alpha:false});
        ctx.drawImage(img,r.x*sx,r.y*sy,r.width*sx,r.height*sy,0,0,canvas.width,canvas.height);
      }finally{img.close();}
    }else{
      for(let n=0;covered<initial.height-.5;n++){
        checkStop();if(n>=120)throw new Error('Η σελίδα είναι υπερβολικά μεγάλη. Χώρισέ την σε τμήματα.');
        status(`${batch?'Σελίδα '+(index+1):'Συρραφή σελίδας'} · ${Math.round(covered/initial.height*100)}%`);
        m=await command('move',{covered},t);
        if(m.url!==expectedUrl)throw new Error('Άλλαξε το έγγραφο κατά τη λήψη.');
        const slice=tileSlice(m.rect,m.clip,covered);
        if(!slice)throw new Error('Δεν είναι δυνατή η συνέχεια της κύλισης. Χρησιμοποίησε «Μόνο ορατό τμήμα» και ένωση τμημάτων, ή διόρθωσε τα όρια.');
        const img=await screenshot(t);
        try{
          const after=await command('metrics',{},t);
          if(Math.abs(after.rect.y-m.rect.y)>1||Math.abs(after.rect.x-m.rect.x)>1||after.url!==expectedUrl)throw new Error('Ο viewer κινήθηκε κατά τη λήψη. Περίμενε να σταθεροποιηθεί.');
          const sx=img.width/m.viewport.width, sy=img.height/m.viewport.height;
          if(!canvas){const size=outputSize(initial.width*sx,initial.height*sy,0);canvas=document.createElement('canvas');canvas.width=size.width;canvas.height=size.height;ctx=canvas.getContext('2d',{alpha:false});ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);}
          const dy=Math.round(slice.dy/initial.height*canvas.height), bottom=Math.round(slice.end/initial.height*canvas.height);
          ctx.drawImage(img,slice.sx*sx,slice.sy*sy,slice.sw*sx,slice.sh*sy,0,dy,canvas.width,bottom-dy);
        }finally{img.close();}
        covered=slice.end;if(!batch)$('progress').value=covered/initial.height;onTile(covered/initial.height);
      }
    }
    checkStop();
    const blob=await canvasBlob(canvas);
    const record=await addPage(blob,canvas.width,canvas.height,{sourceUrl:m.url,sourceTitle:m.title,label:m.label||'',snippet:onlyVisible});
    if(record.added&&!batch)status(`Κρατήθηκε ${onlyVisible?'το ορατό τμήμα':'η σελίδα'} · ${canvas.width} × ${canvas.height} px.`);return record;
  }finally{
    if(started)await command('end',{restore:!batch},t).catch(()=>{});
    if(canvas){canvas.width=1;canvas.height=1;}
  }
}
async function startBatch(){
  const t=await ensure(),first=Number($('startPage').value)-1,count=Number($('pageCount').value);
  if(!Number.isInteger(first)||first<0||!Number.isInteger(count)||count<1||count>1000)throw new Error('Δώσε αρχική θέση ≥ 1 και πλήθος από 1 έως 1000.');
  const s=await command('selection',{},t);if(!s?.calibrated)throw new Error('Σχεδίασε μία σελίδα και όρισε την αρχή της επόμενης πριν ξεκινήσεις.');showBounds(s);
  const restore=$('returnPosition').checked,auto=$('autoExport').value,ids=[];let completed=0,started=false;
  batchRunning=true;paused=false;$('pause').disabled=false;$('pause').textContent='Παύση';
  try{
    await command('begin-run',{},t);started=true;
    const result=await runBatch({first,count,
      checkStop,
      beforePage:async()=>{while(paused){checkStop();status('Σε παύση. Πάτησε «Συνέχεια» για την επόμενη σελίδα.');await new Promise(r=>setTimeout(r,120));}},
      prepare:async index=>{checkStop();await command('prepare',{index},t);},
      capture:async index=>{const record=await capturePage(false,{index,batch:true,target:t,onTile:f=>$('progress').value=(completed+f)/count});ids.push(record.id);return record;},
      onProgress:r=>{completed=r.completed;$('progress').value=r.completed/count;$('runStats').textContent=`${r.completed}/${count} λήψεις · ${r.added} νέες · ${r.duplicates} ήδη στη συλλογή.`;},
      settle:async(error,index)=>{status(`Προσαρμογή μετά από zoom / αλλαγή διάταξης · επανάληψη θέσης ${index+1}…`);await new Promise(r=>setTimeout(r,700));}
    });
    if(ids.length){selected=new Set(ids);await renderList();}
    $('runStats').textContent=`Ολοκληρώθηκαν ${result.completed} λήψεις · ${result.added} νέες · ${result.reason==='end'?'τέλος εγγράφου':'όριο πλήθους'}.`;
    status(`Κρατήθηκαν ${result.added} νέες σελίδες${result.duplicates?' · '+result.duplicates+' υπήρχαν ήδη':''}. ${result.reason==='end'?'Φτάσαμε στο τέλος του εγγράφου.':''}`);
    checkStop();
    if(auto!=='none'&&ids.length){await command('end-run',{restore},t);started=false;batchRunning=false;$('pause').disabled=true;await exportImages(auto);}
  }finally{
    if(started)await command('end-run',{restore},t).catch(()=>{});batchRunning=false;paused=false;$('pause').textContent='Παύση';$('pause').disabled=true;
  }
}
async function openSplitter(scanId){
  let id=scanId||lastScanId;const current=id?await getScan(id):null;
  if(!current?.savedHeight){const available=(await listScans()).filter(s=>s.savedHeight>0).sort((a,b)=>b.created.localeCompare(a.created));id=available[0]?.id;}
  if(!id)throw new Error('Κράτησε πρώτα μία ενιαία εικόνα.');
  const url=chrome.runtime.getURL('splitter.html')+'?scan='+encodeURIComponent(id);await chrome.windows.create({url,type:'popup',width:1180,height:860});
}
async function startScan(){
  const t=await ensure(),operationOpts={...opts(),mode:'manual'},first=Number($('scanFirst').value)-1,count=Number($('scanCount').value);
  if(operationOpts.rangeMode==='repeat'&&(!Number.isInteger(first)||first<0||!Number.isInteger(count)||count<1||count>1000))throw new Error('Δώσε έγκυρη αρχή και πλήθος για το επαναλαμβανόμενο εύρος.');
  $('scanProgress').hidden=false;$('scanProgress').value=0;
  const scan=await captureScan({opts:operationOpts,first:operationOpts.rangeMode==='repeat'?first:0,count:operationOpts.rangeMode==='repeat'?count:1,command:(op,extra={})=>command(op,{opts:operationOpts,...extra},t),screenshot:()=>screenshot(t),checkStop,
    onSaved:s=>{lastScanId=s.id;chrome.storage.local.set({lastScanId:s.id}).catch(reportError);},
    onProgress:p=>{const prefix=p.stage==='preload'?'Φόρτωση ολόκληρου του εύρους':'Ενιαία καταγραφή χωρίς τις μπάρες';status(prefix+' · '+Math.round(p.fraction*100)+'%');$('scanProgress').value=p.stage==='preload'?p.fraction*.25:.25+p.fraction*.75;$('scanStats').textContent=p.stage==='preload'?`Προφόρτωση · ${p.steps} θέσεις`:`${p.tiles} τμήματα · ${p.savedHeight} σειρές εικόνας`;}
  });
  $('scanStats').textContent=`Ενιαία εικόνα ${scan.width} × ${scan.savedHeight} px · ${scan.tiles.length} τμήματα.`;
  status('Η ενιαία εικόνα αποθηκεύτηκε. Ανοίγει ο διαχωρισμός σε σελίδες.');await openSplitter(scan.id);
}
async function reorder(index,delta){const other=index+delta;if(other<0||other>=pages.length)return;[pages[index],pages[other]]=[pages[other],pages[index]];pages.forEach((p,i)=>p.order=i);await replacePages(pages);await renderList();}
async function renderList(){
  urls.forEach(URL.revokeObjectURL);urls=[];$('pages').replaceChildren();
  $('count').textContent=pages.length;$('total').textContent=mb(pages.reduce((n,p)=>n+p.blob.size,0));
  if(!pages.length){const e=document.createElement('p');e.className='empty';e.textContent='Οι σελίδες που κρατάς θα εμφανίζονται εδώ. Η συλλογή αποθηκεύεται τοπικά.';$('pages').append(e);return;}
  for(let i=0;i<pages.length;i++){
    const p=pages[i],card=document.createElement('div');card.className='page-card'+(selected.has(p.id)?' selected':'');
    const cb=document.createElement('input');cb.type='checkbox';cb.checked=selected.has(p.id);cb.setAttribute('aria-label','Επιλογή σελίδας '+(i+1));cb.disabled=busy;
    cb.addEventListener('change',()=>{if(cb.checked)selected.add(p.id);else selected.delete(p.id);card.classList.toggle('selected',cb.checked);});
    const img=document.createElement('img');const url=URL.createObjectURL(p.thumbnail||p.blob);urls.push(url);img.src=url;img.alt='Προεπισκόπηση '+(i+1);img.loading='lazy';img.decoding='async';img.addEventListener('click',()=>{if(!busy)task(()=>openEditor(p));});
    const info=document.createElement('div'),name=document.createElement('strong');name.textContent=`${i+1}. ${p.snippet?'Τμήμα':p.label?'Σελίδα '+p.label:'Σελίδα'}${p.crop?' · περικοπή':''}`;
    const meta=document.createElement('div');meta.className='meta';meta.textContent=`${p.width} × ${p.height} · ${mb(p.blob.size)}${p.rotation?' · '+p.rotation+'°':''}`;meta.title=p.sourceUrl||'';
    const actions=document.createElement('div');actions.className='actions';
    for(const [text,title,fn] of [['↗','Προεπισκόπηση / περικοπή',()=>openEditor(p)],['↑','Μετακίνηση επάνω',()=>reorder(i,-1)],['↓','Μετακίνηση κάτω',()=>reorder(i,1)],['×','Διαγραφή σελίδας',async()=>{await deletePage(p.id);pages=pages.filter(x=>x.id!==p.id);selected.delete(p.id);await renderList();status('Η σελίδα αφαιρέθηκε.');}]]){
      const b=document.createElement('button');b.textContent=text;b.title=title;b.setAttribute('aria-label',title);b.disabled=busy;b.addEventListener('click',()=>task(fn));actions.append(b);
    }
    info.append(name,meta,actions);card.append(cb,img,info);$('pages').append(card);
  }
}
const downloadUrls=new Map();
chrome.downloads.onChanged.addListener(delta=>{if(delta.state?.current==='complete'||delta.state?.current==='interrupted'){const url=downloadUrls.get(delta.id);if(url){URL.revokeObjectURL(url);downloadUrls.delete(delta.id);}}});
async function download(blob,name){
  const url=URL.createObjectURL(blob);
  try{const id=await chrome.downloads.download({url,filename:name,saveAs:true});downloadUrls.set(id,url);setTimeout(()=>{if(downloadUrls.has(id)){URL.revokeObjectURL(url);downloadUrls.delete(id);}},3600000);}
  catch(e){URL.revokeObjectURL(url);throw e;}
}
async function exportImages(kind){
  const list=selectedPages();if(!list.length)throw new Error('Κράτησε τουλάχιστον μία σελίδα.');
  const images=[];
  for(let i=0;i<list.length;i++){checkStop();status(`Προετοιμασία ${i+1}/${list.length}…`);images.push(await renderPage(list[i],{...config(),type:kind==='pdf'?'image/jpeg':$('imageFormat').value}));$('progress').value=(i+1)/list.length;}
  checkStop();const name=safeName($('title').value);
  const blob=kind==='pdf'?await makePDF(images,{size:$('paper').value,title:$('title').value}):await makeZIP(images.map((p,i)=>({name:`${name}/${String(i+1).padStart(4,'0')}.${$('imageFormat').value==='image/png'?'png':'jpg'}`,blob:p.blob})));
  checkStop();await download(blob,name+(kind==='pdf'?'.pdf':'.zip'));status(`Ετοιμάστηκε ${kind==='pdf'?'PDF':'ZIP εικόνων'} · ${list.length} σελίδες · ${mb(blob.size)}.`);
}
async function backup(){
  const list=selectedPages();if(!list.length)throw new Error('Η συλλογή είναι κενή.');
  status('Δημιουργία αντιγράφου με τις αρχικές λήψεις…');
  const records=[];
  for(const p of list){checkStop();const {blob,thumbnail,...rest}=p;records.push({...rest,image:await blobDataURL(blob)});$('progress').value=records.length/list.length;}
  const b=new Blob([JSON.stringify({format:'ReaderCapture',version:1,title:$('title').value,pages:records})],{type:'application/json'});
  if(b.size>300*1024*1024)throw new Error('Το αντίγραφο ξεπερνά τα 300 MB. Επίλεξε λιγότερες σελίδες και πάρε ξεχωριστά αντίγραφα.');
  await download(b,safeName($('title').value)+'.rcap');status('Το αντίγραφο συλλογής είναι έτοιμο. Περιλαμβάνει τις αρχικές εικόνες και τις περικοπές.');
}
async function restore(file){
  if(!file)return;
  if(file.size>300*1024*1024)throw new Error('Το αντίγραφο είναι μεγαλύτερο από 300 MB. Χώρισέ το σε μικρότερες συλλογές.');
  const data=JSON.parse(await file.text());
  if(data.format!=='ReaderCapture'||data.version!==1||!Array.isArray(data.pages)||data.pages.length>1000)throw new Error('Μη έγκυρο αντίγραφο ReaderCapture.');
  const restored=[];
  for(const p of data.pages){
    checkStop();if(typeof p.image!=='string'||!/^data:image\/(png|jpeg);base64,[a-zA-Z0-9+/=]+$/.test(p.image))throw new Error('Το αντίγραφο περιέχει μη έγκυρη εικόνα.');
    const blob=await(await fetch(p.image)).blob();const bitmap=await createImageBitmap(blob);const width=bitmap.width,height=bitmap.height;bitmap.close();
    if(width*height>40000000)throw new Error('Υπερβολικά μεγάλη εικόνα στο αντίγραφο.');
    let crop=null;
    if(p.crop){const {x,y,width:w,height:h}=p.crop;if([x,y,w,h].every(Number.isFinite)&&x>=0&&y>=0&&w>0&&h>0&&x+w<=width&&y+h<=height)crop={x,y,width:w,height:h};else throw new Error('Μη έγκυρα όρια περικοπής.');}
    const order=(pages.length?Math.max(...pages.map(p=>p.order))+1:0)+restored.length;
    const record={id:crypto.randomUUID(),order,blob,width,height,crop,rotation:[0,90,180,270].includes(p.rotation)?p.rotation:0,label:String(p.label||''),sourceUrl:String(p.sourceUrl||''),sourceTitle:String(p.sourceTitle||''),created:String(p.created||''),snippet:!!p.snippet,hash:await hashBlob(blob)};
    record.thumbnail=await thumb(record);restored.push(record);
  }
  // Import appends; original pages remain, even if validation fails halfway through.
  checkStop();await replacePages([...pages,...restored]);pages.push(...restored);selected.clear();
  if(data.title)$('title').value=safeName(data.title);await saveSettings();await renderList();status(`Προστέθηκαν ${restored.length} σελίδες από το αντίγραφο.`);
}
async function join(){
  const list=pages.filter(p=>selected.has(p.id));if(list.length<2)throw new Error('Επίλεξε τουλάχιστον δύο τμήματα με τα κουτάκια.');
  const overlap=Number($('overlap').value)||0, images=[];let canvas;
  try{
    for(const p of list){checkStop();const rendered=await renderPage(p,{type:'image/png'});images.push(await createImageBitmap(rendered.blob));}
    const width=images[0].width;
    if(images.some(x=>Math.abs(x.width-width)>2))throw new Error('Τα τμήματα πρέπει να έχουν το ίδιο πλάτος. Περικόψε τα πριν την ένωση.');
    if(images.slice(1).some(x=>x.height<=overlap))throw new Error('Η επικάλυψη είναι μεγαλύτερη από κάποιο τμήμα.');
    const height=images.reduce((n,p)=>n+p.height,0)-overlap*(images.length-1), size=outputSize(width,height,0);
    canvas=document.createElement('canvas');canvas.width=size.width;canvas.height=size.height;const ctx=canvas.getContext('2d',{alpha:false});let y=0;
    images.forEach((im,i)=>{const cut=i?overlap:0;ctx.drawImage(im,0,cut,im.width,im.height-cut,0,y*size.scale,size.width,(im.height-cut)*size.scale);y+=im.height-cut;});
    const record=await addPage(await canvasBlob(canvas),canvas.width,canvas.height,{sourceUrl:list[0].sourceUrl,sourceTitle:list[0].sourceTitle,label:'Ένωση',snippet:false});
    if(record.added){selected.clear();selected.add(record.id);await renderList();status('Δημιουργήθηκε ενωμένη σελίδα. Τα αρχικά τμήματα διατηρήθηκαν· στην εξαγωγή επιλέγεται η νέα σελίδα.');}
  }finally{images.forEach(im=>im.close());if(canvas)canvas.width=canvas.height=1;}
}

let editing=null,editRotation=0,editCrop=null,editUrl=null,cropStart=null;
async function showEditorImage(){
  const r=await renderPage({...editing,rotation:editRotation,crop:null},{type:'image/png'});if(editUrl)URL.revokeObjectURL(editUrl);editUrl=URL.createObjectURL(r.blob);$('editImage').src=editUrl;$('cropBox').hidden=true;editCrop=null;
}
async function openEditor(p){
  editing=p;editRotation=p.rotation||0;await showEditorImage();
  if(p.crop){
    const c={x:p.crop.x/p.width,y:p.crop.y/p.height,width:p.crop.width/p.width,height:p.crop.height/p.height};
    let {x,y,width,height}=c;
    if(editRotation===90)[x,y,width,height]=[1-c.y-c.height,c.x,c.height,c.width];
    if(editRotation===180)[x,y,width,height]=[1-c.x-c.width,1-c.y-c.height,c.width,c.height];
    if(editRotation===270)[x,y,width,height]=[c.y,1-c.x-c.width,c.height,c.width];
    editCrop={x,y,width,height};cropDraw(editCrop);
  }
  $('editor').showModal();
}
function cropDraw(r){const b=$('cropBox');b.hidden=false;Object.assign(b.style,{left:r.x*100+'%',top:r.y*100+'%',width:r.width*100+'%',height:r.height*100+'%'});}
$('editStage').addEventListener('pointerdown',e=>{if(!editing)return;e.preventDefault();const r=$('editStage').getBoundingClientRect();cropStart={x:Math.max(0,Math.min(1,(e.clientX-r.x)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.y)/r.height))};$('editStage').setPointerCapture(e.pointerId);});
$('editStage').addEventListener('pointermove',e=>{if(!cropStart)return;const r=$('editStage').getBoundingClientRect(),x=Math.max(0,Math.min(1,(e.clientX-r.x)/r.width)),y=Math.max(0,Math.min(1,(e.clientY-r.y)/r.height));editCrop={x:Math.min(cropStart.x,x),y:Math.min(cropStart.y,y),width:Math.abs(x-cropStart.x),height:Math.abs(y-cropStart.y)};cropDraw(editCrop);});
$('editStage').addEventListener('pointerup',()=>{cropStart=null;if(editCrop&&(editCrop.width<.01||editCrop.height<.01)){editCrop=null;$('cropBox').hidden=true;}});
$('rotate').addEventListener('click',()=>task(async()=>{editRotation=(editRotation+90)%360;await showEditorImage();}));
$('resetCrop').addEventListener('click',()=>task(async()=>{editRotation=0;await showEditorImage();}));
$('closeEditor').addEventListener('click',()=>$('editor').close());
$('editor').addEventListener('close',()=>{if(editUrl)URL.revokeObjectURL(editUrl);editUrl=null;editing=null;});
$('saveCrop').addEventListener('click',()=>task(async()=>{
  if(!editing)return;const p={...editing,rotation:editRotation,crop:null};
  if(editCrop){
    // Map the axis-aligned crop in the rotated preview back to original pixels.
    const c=editCrop,W=p.width,H=p.height;let x=c.x,y=c.y,w=c.width,h=c.height;
    if(editRotation===90)[x,y,w,h]=[c.y,1-c.x-c.width,c.height,c.width];
    if(editRotation===180)[x,y,w,h]=[1-c.x-c.width,1-c.y-c.height,c.width,c.height];
    if(editRotation===270)[x,y,w,h]=[1-c.y-c.height,c.x,c.height,c.width];
    const left=Math.max(0,Math.round(x*W)),top=Math.max(0,Math.round(y*H));
    p.crop={x:left,y:top,width:Math.max(1,Math.min(W-left,Math.round(w*W))),height:Math.max(1,Math.min(H-top,Math.round(h*H)))};
  }
  p.thumbnail=await thumb(p);await putPage(p);pages[pages.findIndex(x=>x.id===p.id)]=p;$('editor').close();await renderList();status('Αποθηκεύτηκε η περικοπή / περιστροφή.');
}));

$('connect').addEventListener('click',()=>task(async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab)throw new Error('Δεν βρέθηκε καρτέλα.');const t={id:tab.id,windowId:tab.windowId,url:tab.url,title:tab.title};await ensure(t);target=t;await chrome.storage.session.set({target:t});source();status('Συνδέθηκε το έγγραφο.');}));
$('detect').addEventListener('click',()=>task(async()=>{await ensure();const m=await command('calibrate-auto');showBounds(m);status('Εντοπίστηκε σελίδα. Έλεγξε το πράσινο πλαίσιο και το βήμα.');}));
$('pick').addEventListener('click',()=>task(async()=>{await ensure();await command('pick',{kind:'element'});status('Κάνε κλικ στη σελίδα που θέλεις να κρατήσεις.');}));
$('draw').addEventListener('click',()=>task(async()=>{await ensure();await command('pick',{kind:'manual'});status('Σχεδίασε την περιοχή πάνω στο έγγραφο. Esc για ακύρωση.');}));
$('capture').addEventListener('click',()=>task(()=>capturePage(false)));
$('visible').addEventListener('click',()=>task(()=>capturePage(true)));
$('cancel').addEventListener('click',()=>{stopped=true;paused=false;status('Διακοπή και διατήρηση των ολοκληρωμένων σελίδων…');});
$('batchStart').addEventListener('click',()=>task(startBatch));
$('scanStart').addEventListener('click',()=>task(startScan));
$('scanCancel').addEventListener('click',()=>{stopped=true;status('Διακοπή. Τα ήδη αποθηκευμένα τμήματα διατηρούνται.');});
$('openSplitter').addEventListener('click',()=>task(()=>openSplitter()));
$('pickBar').addEventListener('click',()=>task(async()=>{await ensure();await command('pick',{kind:'bar'});status('Κάνε κλικ στη σταθερή μπάρα πάνω στην ιστοσελίδα.');}));
$('pause').addEventListener('click',()=>{if(!batchRunning)return;paused=!paused;$('pause').textContent=paused?'Συνέχεια':'Παύση';status(paused?'Θα γίνει παύση μετά την τρέχουσα σελίδα.':'Η λήψη συνεχίζεται.');});
$('measureGap').addEventListener('click',()=>task(async()=>{await ensure();await command('measure-gap');status('Κύλα στην επόμενη σελίδα και κάνε κλικ στην αρχή της. Η απόσταση μετριέται μαζί με την κύλιση.');}));
$('applyGeometry').addEventListener('click',()=>task(async()=>{await ensure();showBounds(await command('set-geometry',{values:{width:Number($('width').value),height:Number($('height').value),gap:Number($('gap').value)}}));await saveSettings();status('Εφαρμόστηκαν οι διαστάσεις.');}));
for(const [id,op] of [['showOverlay','show-overlay'],['hideOverlay','hide-overlay']])$(id).addEventListener('click',()=>task(async()=>{await ensure();const m=await command(op);if(m?.rect)showBounds(m);}));
for(const [id,index] of [['previewFirst',0],['previewNext',1]])$(id).addEventListener('click',()=>task(async()=>{await ensure();await command('goto',{index});status('Έλεγξε τη θέση του πλαισίου πριν ξεκινήσεις τη λήψη.');}));
$('copyError').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('errorText').textContent);status('Αντιγράφηκε το πλήρες μήνυμα σφάλματος.');}catch{status('Επίλεξε και αντέγραψε το κείμενο από τις λεπτομέρειες σφάλματος.');}});
for(const [id,direction] of [['next',1],['previous',-1]])$(id).addEventListener('click',()=>task(async()=>{await ensure();await command('next',{direction});status('Μετακινήθηκε το έγγραφο. Έλεγξε τη σελίδα και κράτησέ την όταν θέλεις.');}));
$('pdf').addEventListener('click',()=>task(()=>exportImages('pdf')));
$('images').addEventListener('click',()=>task(()=>exportImages('images')));
$('estimate').addEventListener('click',()=>task(async()=>{
  const list=selectedPages();if(!list.length)throw new Error('Η συλλογή είναι κενή.');let bytes=0;
  for(let i=0;i<list.length;i++){checkStop();bytes+=(await renderPage(list[i],config())).blob.size;$('progress').value=(i+1)/list.length;status(`Υπολογισμός ${i+1}/${list.length}…`);}
  $('estimateText').textContent=`Εκτίμηση PDF: ${mb(bytes+list.length*1000)} · ${list.length} σελίδες. Οι αρχικές λήψεις διατηρούνται.`;status('Ολοκληρώθηκε ο υπολογισμός μεγέθους.');
}));
$('backup').addEventListener('click',()=>task(backup));
$('restore').addEventListener('click',()=>$('restoreFile').click());
$('restoreFile').addEventListener('change',()=>{const file=$('restoreFile').files[0];$('restoreFile').value='';task(()=>restore(file));});
$('selectAll').addEventListener('click',()=>{if(selected.size===pages.length)selected.clear();else pages.forEach(p=>selected.add(p.id));renderList();});
$('join').addEventListener('click',()=>task(join));
$('new').addEventListener('click',()=>task(async()=>{
  if(pages.length&&!confirm('Να καθαριστεί η τοπική συλλογή; Πάρε αντίγραφο .rcap πρώτα αν θέλεις να την επεξεργαστείς ξανά.'))return;
  await clearPages();pages=[];selected.clear();$('title').value='Το έγγραφό μου';await saveSettings();await renderList();status('Ξεκίνησε νέα συλλογή.');
}));
$('help').addEventListener('click',()=>chrome.tabs.create({url:chrome.runtime.getURL('help.html')}));
$('findPdf').addEventListener('click',()=>task(async()=>{
  await ensure();const links=await command('links');$('pdfLinks').replaceChildren();
  for(const link of links){const a=document.createElement('a');a.href=link.url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=link.label+' · '+link.url;$('pdfLinks').append(a);}
  status(links.length?`Βρέθηκαν ${links.length} σύνδεσμοι PDF. Άνοιξε τον σύνδεσμο και χρησιμοποίησε τη λήψη του browser.`:'Δεν βρέθηκαν εμφανείς σύνδεσμοι .pdf στη σελίδα.');
}));
$('preset').addEventListener('change',()=>{const values={reading:[1600,88],small:[1100,72],original:[0,95]}[$('preset').value];if(values){$('maxWidth').value=values[0];$('quality').value=values[1];$('qualityLabel').textContent=values[1]+'%';saveSettings();}});
for(const id of settingsIds)$(id)?.addEventListener('input',()=>{if(id==='quality')$('qualityLabel').textContent=$('quality').value+'%';if(['maxWidth','quality'].includes(id))$('preset').value='custom';if(id==='batchMode')$('pageCountLabel').firstChild.textContent=$('batchMode').value==='end'?'Ανώτατο όριο':'Πλήθος σελίδων';if(id==='rangeMode')$('repeatRange').hidden=$('rangeMode').value!=='repeat';if(['edgeSpeed','lockRatio'].includes(id)&&target)command('configure').catch(()=>{});clearTimeout(saveTimer);saveTimer=setTimeout(saveSettings,250);});
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='session'&&changes.target){if(busy&&target?.id!==changes.target.newValue?.id)stopped=true;target=changes.target.newValue;source();}});
chrome.runtime.onMessage.addListener((m,sender)=>{
  if(m.type==='scan-pages-added')allPages().then(p=>{pages=p.sort((a,b)=>a.order-b.order);selected.clear();renderList();}).catch(reportError);
  if(m.type==='bar-selected'&&sender.tab?.id===target?.id)status('Σημειώθηκε η μπάρα. Οι γραμμές πίσω της θα ληφθούν από άλλη θέση κύλισης.');
  if(['bounds-selected','bounds-changed','spacing-selected'].includes(m.type)&&sender.tab?.id===target?.id){showBounds(m.data);saveSettings();if(!busy&&m.type!=='bounds-changed')status(m.type==='spacing-selected'?'Ορίστηκε το βήμα. Διάλεξε πλήθος σελίδων και ξεκίνα.':'Η περιοχή έγινε πράσινη. Ρύθμισέ την και όρισε την επόμενη αρχή.');}
  if(m.type==='capture-cancelled'){stopped=true;paused=false;}
  if(m.type==='selection-cancelled')status('Η επιλογή περιοχής ακυρώθηκε.');
  if(m.type==='shortcut-capture'&&!busy)task(()=>capturePage(false));
});
window.addEventListener('beforeunload',()=>{if(busy&&target){command('end-strip',{},target).catch(()=>{});command(batchRunning?'end-run':'end',{},target).catch(()=>{});}});
async function init(){
  setBusy(true);
  const [{settings={},settingsVersion,lastScanId:last},{target:t},stored]=await Promise.all([chrome.storage.local.get(['settings','settingsVersion','lastScanId']),chrome.storage.session.get('target'),allPages()]);lastScanId=last||null;
  for(const id of settingsIds)if(settings[id]!==undefined){if($(id).type==='checkbox')$(id).checked=!!settings[id];else $(id).value=settings[id];}
  if(settingsVersion!==3)$('mode').value='manual';
  $('repeatRange').hidden=$('rangeMode').value!=='repeat';
  $('qualityLabel').textContent=$('quality').value+'%';target=t||null;pages=stored.sort((a,b)=>a.order-b.order);source();await renderList();
  if(target){try{await ensure();const s=await command('selection');if(s)showBounds(s);}catch{}}
  if(pages.length)status(`Ανακτήθηκαν ${pages.length} σελίδες της συλλογής σου.`);
}
init().catch(reportError).finally(()=>setBusy(false));
