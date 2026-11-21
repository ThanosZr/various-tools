export function intersection(a, b) {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  return {x, y, width: Math.max(0, Math.min(a.x+a.width, b.x+b.width)-x), height: Math.max(0, Math.min(a.y+a.height, b.y+b.height)-y)};
}

// Return only still-uncovered rows. Coordinates are in CSS pixels until canvas draw.
export function tileSlice(rect, viewport, covered) {
  const visible = intersection(rect, viewport);
  if (visible.width < rect.width - 2) throw new Error('Η σελίδα δεν χωρά οριζόντια. Μείωσε το zoom ή στένεψε την περιοχή.');
  const start = Math.max(covered, visible.y - rect.y);
  const end = Math.min(rect.height, visible.y + visible.height - rect.y);
  if (start > covered + 2) throw new Error('Υπάρχει κενό στη συρραφή. Ρύθμισε το επάνω περιθώριο και ξαναδοκίμασε.');
  if (end <= start + 0.1) return null;
  return {sx: rect.x, sy: rect.y+start, sw: rect.width, sh: end-start, dy: start, end};
}

export function outputSize(w, h, maxWidth, maxPixels = 40000000) {
  const scale = Math.min(1, (maxWidth || w)/w, Math.sqrt(maxPixels/(w*h)), 30000/w, 30000/h);
  return {width: Math.max(1, Math.round(w*scale)), height: Math.max(1, Math.round(h*scale)), scale};
}

export function pageBox(w, h, mode) {
  if (mode === 'original') return {width: w * 0.75, height: h * 0.75, x:0, y:0, drawWidth:w*0.75, drawHeight:h*0.75};
  let width = mode === 'letter' ? 612 : 595.276, height = mode === 'letter' ? 792 : 841.89;
  if (w > h) [width, height] = [height, width];
  const scale = Math.min(width/w, height/h);
  return {width, height, x:(width-w*scale)/2, y:(height-h*scale)/2, drawWidth:w*scale, drawHeight:h*scale};
}

export function safeName(value) {
  return String(value || 'document').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 120) || 'document';
}
