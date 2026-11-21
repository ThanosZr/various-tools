import {pageBox} from './geometry.js';
const enc = new TextEncoder();
const ascii = value => enc.encode(value);

// Minimal image-only PDF writer. JPEG bytes are embedded without recompression.
// UTF-16BE metadata keeps Greek titles intact. No third-party code or CDN.
function pdfString(value) {
  let hex = 'FEFF';
  for (let i = 0; i < value.length; i++) hex += value.charCodeAt(i).toString(16).padStart(4, '0');
  return '<' + hex + '>';
}
export async function makePDF(pages, {size='original', title='ReaderCapture'} = {}) {
  if (!pages.length) throw new Error('Δεν υπάρχουν σελίδες.');
  const parts=[], offsets=[0]; let length=0;
  const append = part => {const b=typeof part==='string'?ascii(part):part; parts.push(b); length+=b.byteLength;};
  const object = (id, body) => {offsets[id]=length; append(`${id} 0 obj\n`); append(body); append('\nendobj\n');};
  append('%PDF-1.4\n%'); append(new Uint8Array([226,227,207,211])); append('\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_,i)=>`${3+i*3} 0 R`).join(' ')}] >>`);
  for (let i=0;i<pages.length;i++) {
    const p=pages[i], id=3+i*3, box=pageBox(p.width,p.height,size);
    const f = n => n.toFixed(3);
    object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(box.width)} ${f(box.height)}] /Resources << /XObject << /Im0 ${id+1} 0 R >> >> /Contents ${id+2} 0 R >>`);
    const bytes = new Uint8Array(await p.blob.arrayBuffer());
    offsets[id+1]=length;
    append(`${id+1} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>\nstream\n`);
    append(bytes); append('\nendstream\nendobj\n');
    const content=`q\n${f(box.drawWidth)} 0 0 ${f(box.drawHeight)} ${f(box.x)} ${f(box.y)} cm\n/Im0 Do\nQ\n`;
    object(id+2, `<< /Length ${ascii(content).length} >>\nstream\n${content}endstream`);
  }
  const infoId=3+pages.length*3;
  object(infoId, `<< /Title ${pdfString(title)} /Producer (ReaderCapture 3.0) >>`);
  const start=length;
  append(`xref\n0 ${infoId+1}\n0000000000 65535 f \n`);
  for(let id=1;id<=infoId;id++) append(`${String(offsets[id]).padStart(10,'0')} 00000 n \n`);
  append(`trailer\n<< /Size ${infoId+1} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${start}\n%%EOF\n`);
  return new Blob(parts,{type:'application/pdf'});
}
