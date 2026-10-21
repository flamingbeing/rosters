// The roster sheet as a one-page A4 PDF, drawn from the same layout as the .xlsx (jsPDF passed in).
import { COL_WIDTHS } from './layout.js';

const hex = argb => '#' + String(argb).slice(-6);

export function buildRosterPdf(jsPDF, layout) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
  const pageW = doc.internal.pageSize.getWidth(), pageH = doc.internal.pageSize.getHeight(), margin = 24;
  const colW = COL_WIDTHS.map(w => (w * 7 + 5) * 0.75);
  const rowH = r => layout.heights[r] || 13;
  const first = 2;
  const totalW = colW.reduce((a, b) => a + b, 0);
  let totalH = 0;
  for (let r = first; r <= layout.rows; r++) totalH += rowH(r);
  const k = Math.min((pageW - 2 * margin) / totalW, (pageH - 2 * margin) / totalH);
  const xAt = c => margin + colW.slice(0, c - 1).reduce((a, b) => a + b, 0) * k;
  const yAt = r => { let y = margin; for (let i = first; i < r; i++) y += rowH(i) * k; return y; };

  for (const c of layout.cells) {
    if (c.r < first) continue;
    const x = xAt(c.c1), y = yAt(c.r);
    const w = xAt(c.c2 + 1) - x, h = yAt(c.r2 + 1) - y;
    if (c.fill) { doc.setFillColor(hex(c.fill)); doc.rect(x, y, w, h, 'F'); }
    if (c.box) { doc.setDrawColor('#000000'); doc.setLineWidth(0.5); doc.rect(x, y, w, h, 'S'); }
    const runs = c.runs || (c.text ? [{ text: String(c.text) }] : []);
    if (!runs.length) continue;
    let size = c.sz * k * 1.15;
    const pad = (c.pad ? 6 : 2) * k;
    const font = (bold, sz) => { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(sz); };
    if (c.runs) {
      // one line of coloured runs (names, " / ", a superscript &): shrink to fit the cell
      const width = s => runs.reduce((t, r) => { font(c.bold, r.sup ? s * 0.65 : s); return t + doc.getTextWidth(r.text); }, 0);
      while (size > 3 && width(size) > w - 2 * pad) size -= 0.25;
      let tx = c.align === 'left' ? x + pad : c.align === 'right' ? x + w - pad - width(size) : x + (w - width(size)) / 2;
      const ty = c.valign === 'top' ? y + pad + size : y + h / 2 + size * 0.35;
      for (const r of runs) {
        const s = r.sup ? size * 0.65 : size;
        font(c.bold, s);
        doc.setTextColor(r.color ? hex(r.color) : c.color ? hex(c.color) : '#000000');
        doc.text(r.text, tx, r.sup ? ty - size * 0.35 : ty);
        tx += doc.getTextWidth(r.text);
      }
      continue;
    }
    font(c.bold, size);
    doc.setTextColor(c.color ? hex(c.color) : '#000000');
    const wrap = c.c2 < 12;
    let lines = String(c.text).split('\n').flatMap(l => wrap ? doc.splitTextToSize(l, w - 2 * pad) : [l]);
    // keep a box's text inside it
    while (wrap && size > 3 && lines.length * size * 1.15 > h - pad) {
      size -= 0.25; font(c.bold, size);
      lines = String(c.text).split('\n').flatMap(l => doc.splitTextToSize(l, w - 2 * pad));
    }
    const lh = size * 1.15;
    let ty = c.valign === 'top' ? y + pad + size : y + h / 2 - (lines.length - 1) * lh / 2 + size * 0.35;
    for (const l of lines) {
      const tw = doc.getTextWidth(l);
      const tx = c.align === 'left' || !wrap ? x + pad : c.align === 'right' ? x + w - pad - tw : x + (w - tw) / 2;
      doc.text(l, tx, ty);
      ty += lh;
    }
  }
  return doc;
}
