import {canvasBlob} from './image.js';
import {putScan,commitScanPage} from './scan-store.js';
import {snapshotSlices,nextMissingRow} from './snapshot-plan.js';

function unchanged(a,b){
  const same=(p,q)=>p&&q&&['x','y','width','height'].every(k=>Math.abs(p[k]-q[k])<.75);
  return a.url===b.url&&['width','height','dpr'].every(k=>a.viewport[k]===b.viewport[k])&&
    ['x','y','width','height'].every(k=>Math.abs(a.rect[k]-b.rect[k])<.75)&&
    same(a.clip,b.clip)&&(a.clips||[a.clip]).length===(b.clips||[b.clip]).length&&(a.clips||[a.clip]).every((p,i)=>same(p,(b.clips||[b.clip])[i]));
}

// Pages are discovered and captured in reading order, without a separate
// whole-document preload pass. Tiles stay provisional until the page is whole.
export async function capturePageWalk({command,screenshot,opts={},count=10,checkStop=()=>{},onProgress=()=>{},onSaved=()=>{},save=putScan,commit=commitScanPage}){
  if(!Number.isInteger(count)||count<1||count>1000)throw new Error('Διάλεξε από 1 έως 1000 σελίδες.');
  let started=false,scan,steps=0,reason='count';const began=Date.now(),fast=opts.walkSpeed!=='careful';
  try{
    const initial=await command('begin-walk',{opts});started=true;
    scan={id:crypto.randomUUID(),version:1,mode:'pages',title:initial.title||'Έγγραφο',sourceUrl:initial.url,created:new Date().toISOString(),status:'capturing',width:0,height:0,savedHeight:0,tiles:[],pages:[],cuts:[0],settings:{pageHeight:0,pageGap:0},performance:{mode:fast?'fast':'careful',frames:0,elapsedMs:0,retries:0,carefulFallbacks:0}};
    await save(scan);onSaved(scan);
    while(scan.pages.length<count){
      let retries=0,completed=false;
      while(!completed){
        checkStop();let page,phase='search';
        const tiles=[],jobs=[],pending=new Set();let covered=0,pixelHeight=0,pagePixels=null,scaleY=1;
        try{
          // Discovery and initial scrolling can fail before there is a bitmap.
          // They need the same bounded recovery as capture and final validation.
          for(;;){
            if(++steps>30000)throw new Error('Έφτασε το όριο βημάτων. Διάλεξε μικρότερο εύρος.');
            checkStop();page=await command('walk-next');
            if(page.state==='page'||page.state==='end')break;
            onProgress({stage:page.state==='loading'?'loading':'search',completed:scan.pages.length,total:count,steps:page.steps});
          }
          if(page.state==='end'){reason='end';completed=true;break;}
          phase='capture';
          for(let n=0;pagePixels===null||pixelHeight<pagePixels;n++){
            if(n>=10000)throw new Error('Η σελίδα χρειάζεται υπερβολικά πολλά τμήματα.');checkStop();
            const m=await command('move',{covered,known:fast?tiles.map(t=>({top:t.pageTop/scaleY,bottom:(t.pageTop+t.height)/scaleY})):[]});
            if(m.pending){onProgress({stage:'center',completed:scan.pages.length,total:count});continue;}
            if(m.url!==initial.url)throw new Error('Άλλαξε το έγγραφο κατά τη λήψη.');
            const im=await screenshot(m);scan.performance.frames++;
            try{
              checkStop();const after=await command('metrics');
              if(!unchanged(m,after))throw Object.assign(new Error('Η προβολή κινήθηκε την ώρα του capture. Η ίδια σελίδα θα επαναληφθεί.'),{code:'LAYOUT_CHANGED'});
              const plan=snapshotSlices(m,im,tiles.map(t=>({top:t.pageTop,bottom:t.pageTop+t.height})),fast),{width,height,sy}=plan;scaleY=sy;
              if(!scan.width)scan.width=width;
              if(width!==scan.width)throw new Error('Άλλαξε το πλάτος των σελίδων. Κράτησε τις διαφορετικές διαστάσεις σε ξεχωριστή λήψη.');
              if(pagePixels!==null&&pagePixels!==height)throw Object.assign(new Error('Άλλαξε η ανάλυση της σελίδας.'),{code:'VIEWPORT_CHANGED'});pagePixels=height;
              if(!plan.slices.length||!plan.slices.some(r=>r.top<=pixelHeight&&r.bottom>pixelHeight))throw Object.assign(new Error('Το επόμενο pixel καλύπτεται. Χρειάζεται διαφορετική θέση κύλισης.'),{code:'OCCLUDED'});
              for(const r of plan.slices){
                // At most two cropped canvases encode concurrently. The frozen
                // source bitmap is released before the next camera movement.
                if(pending.size>=2)await Promise.race(pending);checkStop();
                const rows=r.bottom-r.top,canvas=document.createElement('canvas');canvas.width=scan.width;canvas.height=rows;
                const ctx=canvas.getContext('2d',{alpha:false});ctx.imageSmoothingEnabled=false;ctx.drawImage(im,r.x,r.y,width,rows,0,0,scan.width,rows);
                const tile={id:scan.id+':'+scan.pages.length+':'+tiles.length,scanId:scan.id,y:scan.savedHeight+r.top,pageTop:r.top,width:scan.width,height:rows,source:{position:m.position,rect:{...m.rect},x:r.x,y:r.y,scale:sy}};tiles.push(tile);
                const job=(async()=>{try{tile.blob=await canvasBlob(canvas);return tile;}finally{canvas.width=canvas.height=1;}})();
                jobs.push(job);pending.add(job);job.then(()=>pending.delete(job),()=>pending.delete(job));
              }
              pixelHeight=nextMissingRow(tiles.map(t=>({top:t.pageTop,bottom:t.pageTop+t.height})),height);covered=pixelHeight/sy;
            }finally{im.close();}
            onProgress({stage:'capture',completed:scan.pages.length,total:count,fraction:tiles.reduce((n,t)=>n+t.height,0)/pagePixels,tiles:tiles.length,frames:scan.performance.frames});
          }
          await Promise.all(jobs);tiles.sort((a,b)=>a.y-b.y);
          phase='commit';checkStop();await command('walk-commit');
        }catch(error){
          await Promise.allSettled(jobs);
          checkStop();
          if(['LAYOUT_CHANGED','OCCLUDED'].includes(error.code)&&retries<3){
            const recovery=await command('walk-retry',{attempt:++retries,phase});scan.performance.retries++;
            if(fast&&recovery?.mode==='careful')scan.performance.carefulFallbacks++;
            if(!scan.pages.length)scan.width=0;
            onProgress({stage:'retry',completed:scan.pages.length,total:count,attempt:retries,maxRetries:3,phase,mode:recovery?.mode||'careful',wait:recovery?.wait});continue;
          }
          error.phase=phase;error.attempts=retries+1;
          throw error;
        }
        const record={number:scan.pages.length+1,label:page.label||String(scan.pages.length+1),top:scan.savedHeight,bottom:scan.savedHeight+pixelHeight};
        await commit(scan,tiles,record);onSaved(scan);completed=true;
        onProgress({stage:'saved',completed:scan.pages.length,total:count,savedHeight:scan.savedHeight});
      }
      if(reason==='end')break;
    }
    scan.reason=reason;scan.status='complete';scan.pageHeight=scan.pages[0]?scan.pages[0].bottom-scan.pages[0].top:0;scan.step=scan.pageHeight;scan.performance.elapsedMs=Date.now()-began;
    await save(scan);return scan;
  }catch(error){
    if(scan){scan.status=scan.pages.length?'partial':'failed';scan.error=error.message;scan.performance.elapsedMs=Date.now()-began;await save(scan).catch(()=>{});error.completedPages=scan.pages.length;error.scanId=scan.id;}
    throw error;
  }finally{if(started)await command('end-walk',{restore:opts.returnPosition!==false}).catch(()=>{});}
}
