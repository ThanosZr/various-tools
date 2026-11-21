import {outputSize} from './geometry.js';
export function canvasBlob(canvas,type='image/png',quality=.9) {return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Δεν δημιουργήθηκε εικόνα. Μείωσε τις διαστάσεις.')),type,quality));}
export async function renderPage(page,{maxWidth=0,quality=.88,grayscale=false,type='image/jpeg',ignoreCrop=false}={}) {
  const img=await createImageBitmap(page.blob);
  try {
    const crop=ignoreCrop?{x:0,y:0,width:img.width,height:img.height}:(page.crop || {x:0,y:0,width:img.width,height:img.height});
    const rot=(page.rotation||0)%360, swap=rot===90||rot===270;
    const w=swap?crop.height:crop.width, h=swap?crop.width:crop.height, size=outputSize(w,h,maxWidth);
    const canvas=document.createElement('canvas');canvas.width=size.width;canvas.height=size.height;
    const ctx=canvas.getContext('2d',{alpha:false});ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
    ctx.translate(size.width/2,size.height/2);ctx.rotate(rot*Math.PI/180);
    ctx.filter=grayscale?'grayscale(1)':'none';
    ctx.drawImage(img,crop.x,crop.y,crop.width,crop.height,-crop.width*size.scale/2,-crop.height*size.scale/2,crop.width*size.scale,crop.height*size.scale);
    return {blob:await canvasBlob(canvas,type,quality),width:canvas.width,height:canvas.height};
  } finally {img.close();}
}
export async function thumb(page) {return (await renderPage(page,{maxWidth:160,type:'image/jpeg',quality:.65})).blob;}
export async function hashBlob(blob) {const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()));return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');}
export async function blobDataURL(blob) {return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsDataURL(blob);});}
