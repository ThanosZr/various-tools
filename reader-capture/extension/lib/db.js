let pending;
function db() {
  if(!pending) pending=new Promise((resolve,reject)=>{
    const r=indexedDB.open('ReaderCapture',1);
    r.onupgradeneeded=()=>r.result.createObjectStore('pages',{keyPath:'id'});
    r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error);
  });
  return pending;
}
async function run(mode,fn) {
  const d=await db();
  return new Promise((resolve,reject)=>{const tx=d.transaction('pages',mode); const r=fn(tx.objectStore('pages')); tx.oncomplete=()=>resolve(r?.result); tx.onerror=()=>reject(tx.error); tx.onabort=()=>reject(tx.error || new Error('Η αποθήκευση ακυρώθηκε.'));});
}
export const allPages=()=>run('readonly',s=>s.getAll());
export const putPage=p=>run('readwrite',s=>s.put(p));
export const deletePage=id=>run('readwrite',s=>s.delete(id));
export const clearPages=()=>run('readwrite',s=>s.clear());
export const replacePages=pages=>run('readwrite',s=>{s.clear(); for(const p of pages)s.put(p);});
