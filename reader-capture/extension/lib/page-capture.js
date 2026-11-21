import {canvasBlob} from './image.js';
import {putScan,commitScanPage} from './scan-store.js';

function unchanged(a,b){
  return a.url===b.url&&['width','height','dpr'].every(k=>a.viewport[k]===b.viewport[k])&&
    ['x','y','width','height'].every(k=>Math.abs(a.rect[k]-b.rect[k])<.75)&&
    ['x','y','width','height'].every(k=>Math.abs(a.clip[k]-b.clip[k])<.75);
}
const pixel=n=>Math.floor(n+.5+1e-7);

// Pages are discovered and captured in reading order, without a separate
// whole-document preload pass. Tiles stay provisional until the page is whole.
export async function capturePageWalk({command,screenshot,opts={},count=10,checkStop=()=>{},onProgress=()=>{},onSaved=()=>{},save=putScan,commit=commitScanPage}){
  if(!Number.isInteger(count)||count<1||count>1000)throw new Error('Διάλεξε από 1 έως 1000 σελίδες.');
  let started=false,scan,steps=0,reason='count';
  try{
    const initial=await command('begin-walk',{opts});started=true;
    scan={id:crypto.randomUUID(),version:1,mode:'pages',title:initial.title||'Έγγραφο',sourceUrl:initial.url,created:new Date().toISOString(),status:'capturing',width:0,height:0,savedHeight:0,tiles:[],pages:[],cuts:[0],settings:{pageHeight:0,pageGap:0}};
    await save(scan);onSaved(scan);
    while(scan.pages.length<count){
      let retries=0,completed=false;
      while(!completed){
        checkStop();let page;
        for(;;){
          if(++steps>30000)throw new Error('Έφτασε το όριο βημάτων. Διάλεξε μικρότερο εύρος.');
          checkStop();page=await command('walk-next');
          if(page.state==='page'||page.state==='end')break;
          onProgress({stage:page.state==='loading'?'loading':'search',completed:scan.pages.length,total:count,steps:page.steps});
        }
        if(page.state==='end'){reason='end';completed=true;break;}
        const tiles=[];let covered=0,pixelHeight=0,pagePixels=null;
        try{
          for(let n=0;pagePixels===null||pixelHeight<pagePixels;n++){
            if(n>=10000)throw new Error('Η σελίδα χρειάζεται υπερβολικά πολλά τμήματα.');checkStop();
            const m=await command('move',{covered});
            if(m.pending){onProgress({stage:'center',completed:scan.pages.length,total:count});continue;}
            if(m.url!==initial.url)throw new Error('Άλλαξε το έγγραφο κατά τη λήψη.');
            const im=await screenshot();let canvas;
            try{
              checkStop();const after=await command('metrics');
              if(!unchanged(m,after))throw Object.assign(new Error('Η προβολή κινήθηκε την ώρα του capture. Η ίδια σελίδα θα επαναληφθεί.'),{code:'LAYOUT_CHANGED'});
              const dpr=m.viewport.dpr,sx=Math.abs(im.width-m.viewport.width*dpr)<=2?dpr:im.width/m.viewport.width,sy=Math.abs(im.height-m.viewport.height*dpr)<=2?dpr:im.height/m.viewport.height,width=pixel(page.rect.width*sx),height=pixel(page.rect.height*sy);
              if(!scan.width)scan.width=width;
              if(width!==scan.width)throw new Error('Άλλαξε το πλάτος των σελίδων. Κράτησε τις διαφορετικές διαστάσεις σε ξεχωριστή λήψη.');
              if(pagePixels!==null&&pagePixels!==height)throw Object.assign(new Error('Άλλαξε η ανάλυση της σελίδας.'),{code:'VIEWPORT_CHANGED'});pagePixels=height;
              // Compute the remainder in bitmap rows. Rounding a CSS difference
              // is not equivalent to subtracting two rounded device coordinates.
              const x=pixel(m.rect.x*sx),y=pixel(m.rect.y*sy)+pixelHeight,low=Math.max(0,Math.ceil(m.clip.y*sy-1e-7)),high=Math.min(im.height,Math.floor((m.clip.y+m.clip.height)*sy+1e-7));
              if(x<0||x+width>im.width||m.rect.x<m.clip.x-1||m.rect.x+m.rect.width>m.clip.x+m.clip.width+1)throw new Error('Η σελίδα δεν χωρά οριζόντια. Μείωσε το zoom πριν ξεκινήσεις.');
              if(y<low||y>=high)throw Object.assign(new Error('Το επόμενο pixel καλύπτεται. Χρειάζεται διαφορετική θέση κύλισης.'),{code:'OCCLUDED'});
              const rows=Math.min(height-pixelHeight,high-y);
              canvas=document.createElement('canvas');canvas.width=scan.width;canvas.height=rows;
              const ctx=canvas.getContext('2d',{alpha:false});ctx.imageSmoothingEnabled=false;ctx.drawImage(im,x,y,width,rows,0,0,scan.width,rows);
              tiles.push({id:scan.id+':'+scan.pages.length+':'+tiles.length,scanId:scan.id,y:scan.savedHeight+pixelHeight,width:scan.width,height:rows,blob:await canvasBlob(canvas)});
              pixelHeight+=rows;covered=pixelHeight/sy;
            }finally{im.close();if(canvas)canvas.width=canvas.height=1;}
            onProgress({stage:'capture',completed:scan.pages.length,total:count,fraction:pixelHeight/pagePixels,tiles:tiles.length});
          }
        }catch(error){
          if(['LAYOUT_CHANGED','OCCLUDED'].includes(error.code)&&retries++<3){await command('walk-retry');onProgress({stage:'retry',completed:scan.pages.length,total:count});continue;}
          throw error;
        }
        checkStop();await command('walk-commit');
        const record={number:scan.pages.length+1,label:page.label||String(scan.pages.length+1),top:scan.savedHeight,bottom:scan.savedHeight+pixelHeight};
        await commit(scan,tiles,record);onSaved(scan);completed=true;
        onProgress({stage:'saved',completed:scan.pages.length,total:count,savedHeight:scan.savedHeight});
      }
      if(reason==='end')break;
    }
    scan.reason=reason;scan.status='complete';scan.pageHeight=scan.pages[0]?scan.pages[0].bottom-scan.pages[0].top:0;scan.step=scan.pageHeight;
    await save(scan);return scan;
  }catch(error){
    if(scan){scan.status=scan.pages.length?'partial':'failed';scan.error=error.message;await save(scan).catch(()=>{});error.completedPages=scan.pages.length;error.scanId=scan.id;}
    throw error;
  }finally{if(started)await command('end-walk',{restore:opts.returnPosition!==false}).catch(()=>{});}
}
