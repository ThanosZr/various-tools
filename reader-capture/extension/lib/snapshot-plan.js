export const pixel=n=>Math.floor(n+.5+1e-7);

export function mergeRows(ranges){
  const result=[];
  for(const r of ranges.filter(r=>r.bottom>r.top).sort((a,b)=>a.top-b.top)){
    const previous=result.at(-1);
    if(previous&&r.top<=previous.bottom)previous.bottom=Math.max(previous.bottom,r.bottom);
    else result.push({top:r.top,bottom:r.bottom});
  }
  return result;
}
export function nextMissingRow(ranges,height){
  let row=0;for(const r of mergeRows(ranges)){if(r.top>row)break;row=Math.max(row,r.bottom);}return Math.min(height,row);
}
// A frozen screenshot may contain several useful bands separated by a toolbar.
// Record all of them at their document positions, then fill only the remaining
// gaps from later screenshots. The page is committed in row order at the end.
export function snapshotSlices(m,bitmap,known=[],allBands=true){
  const dpr=m.viewport.dpr,sx=Math.abs(bitmap.width-m.viewport.width*dpr)<=2?dpr:bitmap.width/m.viewport.width,sy=Math.abs(bitmap.height-m.viewport.height*dpr)<=2?dpr:bitmap.height/m.viewport.height;
  const width=pixel(m.rect.width*sx),height=pixel(m.rect.height*sy),x=pixel(m.rect.x*sx),originY=pixel(m.rect.y*sy),slices=[];
  if(x<0||x+width>bitmap.width)throw new Error('Η σελίδα δεν χωρά οριζόντια. Μείωσε το zoom πριν ξεκινήσεις.');
  const covered=mergeRows(known),bands=allBands&&m.clips?.length?m.clips:[m.clip];
  for(const band of bands){
    if(m.rect.x<band.x-1||m.rect.x+m.rect.width>band.x+band.width+1)throw new Error('Η σελίδα δεν χωρά οριζόντια στον viewer.');
    const top=Math.max(0,Math.ceil(band.y*sy-1e-7)-originY),bottom=Math.min(height,bitmap.height-originY,Math.floor((band.y+band.height)*sy+1e-7)-originY);
    let row=top;
    for(const r of covered){
      if(r.bottom<=row)continue;if(r.top>=bottom)break;
      if(r.top>row)slices.push({top:row,bottom:Math.min(r.top,bottom),x,y:originY+row});
      row=Math.max(row,r.bottom);if(row>=bottom)break;
    }
    if(row<bottom)slices.push({top:row,bottom,x,y:originY+row});
  }
  return {width,height,sy,slices:slices.filter(r=>r.bottom>r.top).sort((a,b)=>a.top-b.top)};
}
