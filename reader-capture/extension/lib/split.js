import {outputSize} from './geometry.js';
import {canvasBlob} from './image.js';
import {crc32} from './zip.js';

export function normalizeCuts(cuts,height){if(!Number.isInteger(height)||height<1)throw new Error('Μη έγκυρο ύψος εικόνας.');return [0,...[...new Set(cuts.map(Number).filter(Number.isFinite).map(Math.round).filter(y=>y>0&&y<height))].sort((a,b)=>a-b),height];}
export function regularCuts(height,step,offset=0){if(!Number.isFinite(step)||step<10)throw new Error('Το βήμα κοπής πρέπει να είναι τουλάχιστον 10 px.');const cuts=[];for(let y=Number(offset)||0;y<height;y+=step){if(y>0)cuts.push(Math.round(y));if(cuts.length>1000)throw new Error('Ξεπεράστηκαν οι 1000 σελίδες. Αύξησε το ύψος κοπής.');}return normalizeCuts(cuts,height);}
export function splitRanges(cuts,height,{trimTop=0,trimBottom=0,maxHeight=0,excluded=[]}={}){
  const points=normalizeCuts(cuts,height),skip=new Set(excluded);return points.slice(0,-1).flatMap((top,i)=>{const start=top+Math.max(0,Number(trimTop)||0),bottom=Math.min(points[i+1]-Math.max(0,Number(trimBottom)||0),maxHeight>0?top+Number(maxHeight):Infinity);return bottom>start&&!skip.has(i)?[{index:i,top:start,bottom}]:[];});
}
export async function renderScanRegion(scan,range,loadTile,{maxWidth=0,quality=.88,grayscale=false,type='image/jpeg'}={}){
  const size=outputSize(scan.width,range.bottom-range.top,maxWidth),canvas=document.createElement('canvas');canvas.width=size.width;canvas.height=size.height;const ctx=canvas.getContext('2d',{alpha:false});ctx.fillStyle='white';ctx.fillRect(0,0,size.width,size.height);ctx.filter=grayscale?'grayscale(1)':'none';ctx.imageSmoothingEnabled=size.scale<1;ctx.imageSmoothingQuality='high';
  let rows=0;
  for(const tile of scan.tiles){const top=Math.max(range.top,tile.y),bottom=Math.min(range.bottom,tile.y+tile.height);if(bottom<=top)continue;const stored=await loadTile(tile.id);if(!stored?.blob)throw new Error('Λείπει τμήμα της αποθηκευμένης εικόνας.');const im=await createImageBitmap(stored.blob);try{const y0=Math.round((top-range.top)/ (range.bottom-range.top)*size.height),y1=Math.round((bottom-range.top)/(range.bottom-range.top)*size.height);ctx.drawImage(im,0,top-tile.y,tile.width,bottom-top,0,y0,size.width,y1-y0);rows+=bottom-top;}finally{im.close();}}
  if(rows!==range.bottom-range.top)throw new Error('Υπάρχει κενό στην ενιαία εικόνα.');
  return {blob:await canvasBlob(canvas,type,quality),width:canvas.width,height:canvas.height};
}
const encode=new TextEncoder();
function chunk(name,data){const type=encode.encode(name),out=new Uint8Array(data.length+12),view=new DataView(out.buffer);view.setUint32(0,data.length);out.set(type,4);out.set(data,8);view.setUint32(out.length-4,crc32(out.subarray(4,out.length-4)));return out;}
// Stream scanlines through DEFLATE. No full-height canvas or raw full-image buffer.
export async function makeLongPNG(scan,loadTile,{checkStop=()=>{},onProgress=()=>{}}={}){
  const height=scan.savedHeight;if(!scan.width||!height)throw new Error('Δεν υπάρχουν pixels για εξαγωγή.');
  const ihdr=new Uint8Array(13),v=new DataView(ihdr.buffer);v.setUint32(0,scan.width);v.setUint32(4,height);ihdr[8]=8;ihdr[9]=6;
  let tileIndex=0,expected=0;
  const input=new ReadableStream({async pull(controller){try{
    checkStop();if(tileIndex===scan.tiles.length){if(expected!==height)throw new Error('Μη συνεχόμενη εικόνα.');controller.close();return;}
    const t=scan.tiles[tileIndex++];if(t.y!==expected||t.width!==scan.width)throw new Error('Μη συνεχόμενα τμήματα PNG.');const stored=await loadTile(t.id);if(!stored?.blob)throw new Error('Λείπει τμήμα PNG.');const im=await createImageBitmap(stored.blob),canvas=document.createElement('canvas');
    try{canvas.width=t.width;canvas.height=t.height;const ctx=canvas.getContext('2d');ctx.drawImage(im,0,0);const pixels=ctx.getImageData(0,0,t.width,t.height).data,row=t.width*4,filtered=new Uint8Array((row+1)*t.height);for(let y=0;y<t.height;y++)filtered.set(pixels.subarray(y*row,(y+1)*row),y*(row+1)+1);controller.enqueue(filtered);expected+=t.height;onProgress(expected/height);}finally{im.close();canvas.width=canvas.height=1;}
  }catch(error){controller.error(error);}}});
  const reader=input.pipeThrough(new CompressionStream('deflate')).getReader(),parts=[new Uint8Array([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr)];
  try{while(true){checkStop();const {done,value}=await reader.read();if(done)break;parts.push(chunk('IDAT',value));}}catch(error){await reader.cancel(error).catch(()=>{});throw error;}
  parts.push(chunk('IEND',new Uint8Array()));return new Blob(parts,{type:'image/png'});
}
