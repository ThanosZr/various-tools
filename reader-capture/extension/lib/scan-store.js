let opening;
function db(){if(!opening)opening=new Promise((resolve,reject)=>{const r=indexedDB.open('ReaderCaptureScans',1);r.onupgradeneeded=()=>{r.result.createObjectStore('scans',{keyPath:'id'});r.result.createObjectStore('tiles',{keyPath:'id'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});return opening;}
async function transaction(names,mode,fn){const d=await db();return new Promise((resolve,reject)=>{const tx=d.transaction(names,mode),request=fn(tx);tx.oncomplete=()=>resolve(request?.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Δεν αποθηκεύτηκε η ενιαία λήψη.'));});}
export const getScan=id=>transaction(['scans'],'readonly',tx=>tx.objectStore('scans').get(id));
export const putScan=scan=>transaction(['scans'],'readwrite',tx=>tx.objectStore('scans').put(scan));
export const getTile=id=>transaction(['tiles'],'readonly',tx=>tx.objectStore('tiles').get(id));
export const listScans=()=>transaction(['scans'],'readonly',tx=>tx.objectStore('scans').getAll());
export async function appendScanTile(scan,tile){
  if(tile.y!==scan.savedHeight||tile.width!==scan.width||tile.height<1)throw new Error('Μη συνεχόμενα τμήματα στην ενιαία εικόνα.');
  const next={...scan,savedHeight:tile.y+tile.height,tiles:[...scan.tiles,{id:tile.id,y:tile.y,width:tile.width,height:tile.height}]};
  await transaction(['scans','tiles'],'readwrite',tx=>{tx.objectStore('tiles').put(tile);return tx.objectStore('scans').put(next);});Object.assign(scan,next);return scan;
}
