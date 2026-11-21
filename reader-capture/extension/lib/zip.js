const enc = new TextEncoder();
const table = Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++) n=n&1?0xedb88320^(n>>>1):n>>>1; return n>>>0;});
export function crc32(bytes) {let c=0xffffffff; for(const b of bytes)c=table[(c^b)&255]^(c>>>8); return (c^0xffffffff)>>>0;}
function header(size) {const data=new Uint8Array(size); return {data, v:new DataView(data.buffer)};}
export async function makeZIP(files) {
  if(files.length>65535)throw new Error('Πάρα πολλά αρχεία για ZIP.');
  const parts=[], central=[]; let offset=0, centralSize=0;
  for(const file of files) {
    const name=enc.encode(file.name), data=new Uint8Array(await file.blob.arrayBuffer()), crc=crc32(data);
    if(offset+data.length>0xffffffff) throw new Error('Το ZIP ξεπερνά τα 4 GB. Χώρισέ το σε μικρότερα έγγραφα.');
    const h=header(30); h.v.setUint32(0,0x04034b50,true); h.v.setUint16(4,20,true); h.v.setUint16(6,0x800,true);
    h.v.setUint16(12,33,true); h.v.setUint32(14,crc,true); h.v.setUint32(18,data.length,true); h.v.setUint32(22,data.length,true); h.v.setUint16(26,name.length,true);
    parts.push(h.data,name,data);
    const c=header(46); c.v.setUint32(0,0x02014b50,true); c.v.setUint16(4,20,true); c.v.setUint16(6,20,true); c.v.setUint16(8,0x800,true);
    c.v.setUint16(14,33,true); c.v.setUint32(16,crc,true); c.v.setUint32(20,data.length,true); c.v.setUint32(24,data.length,true); c.v.setUint16(28,name.length,true); c.v.setUint32(42,offset,true);
    central.push(c.data,name); centralSize+=c.data.length+name.length; offset+=h.data.length+name.length+data.length;
  }
  const end=header(22); end.v.setUint32(0,0x06054b50,true); end.v.setUint16(8,files.length,true); end.v.setUint16(10,files.length,true); end.v.setUint32(12,centralSize,true); end.v.setUint32(16,offset,true);
  return new Blob([...parts,...central,end.data],{type:'application/zip'});
}
