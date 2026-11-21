import {tileSlice} from './geometry.js';
import {canvasBlob} from './image.js';
import {putScan,appendScanTile} from './scan-store.js';

export async function captureScan({command,screenshot,opts,first=0,count=1,checkStop=()=>{},onProgress=()=>{},onSaved=()=>{},save=putScan,append=appendScanTile}){
  let started=false,scan=null;
  try{
    const initial=await command('begin-strip',{opts,first,count});started=true;
    scan={id:crypto.randomUUID(),version:1,title:initial.title||'Έγγραφο',sourceUrl:initial.url,created:new Date().toISOString(),status:'preloading',width:0,height:0,savedHeight:0,tiles:[],cuts:[],settings:{}};await save(scan);onSaved(scan);
    let offset=0,preloaded=false;
    for(let n=0;n<2000;n++){checkStop();const m=await command('strip-preload',{offset});onProgress({stage:'preload',fraction:Math.min(1,offset/m.rect.height),steps:n+1});if(m.done){preloaded=true;break;}offset=m.nextOffset;}
    if(!preloaded)throw new Error('Το εύρος συνεχίζει να μεγαλώνει. Διάλεξε συγκεκριμένο τέλος.');
    const ready=await command('strip-ready'),rect=ready.rect;let covered=0;
    scan.status='capturing';
    for(let n=0;covered<rect.height-.01;n++){
      if(n>=10000)throw new Error('Υπερβολικά πολλά τμήματα λήψης.');checkStop();
      const m=await command('move',{covered}),slice=tileSlice(m.rect,m.clip,covered);if(!slice)throw new Error('Δεν προχώρησε η λήψη. Έλεγξε τα όρια και τις μπάρες.');
      const im=await screenshot();let canvas;
      try{
        const after=await command('metrics');
        if(after.url!==ready.url||Math.abs(after.rect.y-m.rect.y)>1||Math.abs(after.rect.x-m.rect.x)>1||after.viewport.dpr!==m.viewport.dpr)throw Object.assign(new Error('Μετακινήθηκε η σελίδα ή άλλαξε το zoom κατά τη λήψη. Επανέλαβε τη λήψη με σταθερό zoom.'),{code:'VIEWPORT_CHANGED'});
        const sx=im.width/m.viewport.width,sy=im.height/m.viewport.height;
        if(!scan.width){scan.width=Math.round(rect.width*sx);scan.height=Math.round(rect.height*sy);scan.pageHeight=ready.selection?.calibrated?Math.round(ready.selection.rect.height*sy):Math.round(scan.width*Math.SQRT2);scan.step=ready.selection?.calibrated?Math.round(ready.selection.step*sy):scan.pageHeight;}
        const y=Math.round(slice.dy*sy),bottom=Math.round(slice.end*sy),height=bottom-y;
        if(height>0){canvas=document.createElement('canvas');canvas.width=scan.width;canvas.height=height;const ctx=canvas.getContext('2d',{alpha:false});ctx.drawImage(im,slice.sx*sx,slice.sy*sy,slice.sw*sx,slice.sh*sy,0,0,scan.width,height);const tile={id:scan.id+':'+scan.tiles.length,scanId:scan.id,y,width:scan.width,height,blob:await canvasBlob(canvas)};checkStop();await append(scan,tile);}
      }finally{im.close();if(canvas)canvas.width=canvas.height=1;}
      covered=slice.end;onProgress({stage:'capture',fraction:covered/rect.height,tiles:scan.tiles.length,savedHeight:scan.savedHeight});
    }
    scan.height=scan.savedHeight;scan.status='complete';await save(scan);return scan;
  }catch(error){if(scan){scan.status=scan.savedHeight?'partial':'failed';scan.error=error.message;await save(scan).catch(()=>{});error.scanId=scan.id;error.savedHeight=scan.savedHeight;}throw error;}
  finally{if(started)await command('end-strip',{restore:opts.returnPosition!==false}).catch(()=>{});}
}
