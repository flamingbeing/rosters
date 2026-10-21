// Write a sheet model from js/sheetgen.js as an .xlsx workbook with ExcelJS. The caller passes the ExcelJS module: the
// browser's global (/lib/exceljs.min.js) or node's `exceljs` package, so this file imports nothing.
// Formulas, merged cells, the frozen corner, widths and the colour rules are all written; day cells hold plain values.

const argb = hex => 'FF' + String(hex).toUpperCase();
const fillOf = hex => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: argb(hex) }, bgColor: { argb: argb(hex) } });

export function toWorkbook(model, ExcelJS, sheetName) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName || `1 - ${model.days} ${monthShort(model.month)} Request`, { views: [{ state: 'frozen', xSplit: model.freeze.col, ySplit: model.freeze.row }] });
  for (const [addr, c] of model.cells) {
    const cell = ws.getCell(addr);
    if (c.f) cell.value = { formula: c.f };
    else if (c.v && c.v.date) { const [y, m, d] = c.v.date.split('-').map(Number); cell.value = new Date(Date.UTC(y, m - 1, d)); }
    else cell.value = c.v;
    const st = c.style || {};
    cell.font = { name: 'Arial', size: st.size || 8, bold: !!st.bold };
    if (st.fill) cell.fill = fillOf(st.fill);
    if (st.center) cell.alignment = { horizontal: 'center', vertical: 'middle' };
    if (st.numFmt) cell.numFmt = st.numFmt;
  }
  for (const m of model.merges) ws.mergeCells(m);
  for (const [col, w] of Object.entries(model.widths)) ws.getColumn(Number(col)).width = w;
  for (const r of model.cf) {
    const style = { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: argb(r.fill) } } };
    if (r.font) style.font = { color: { argb: argb(r.font) } };
    let rule;
    if (r.kind === 'equals') rule = { type: 'cellIs', operator: 'equal', formulae: [`"${r.text}"`], style };
    else if (r.kind === 'greaterThan') rule = { type: 'cellIs', operator: 'greaterThan', formulae: [String(r.value)], style };
    else if (r.kind === 'greaterOrEqual') rule = { type: 'cellIs', operator: 'greaterThanOrEqual', formulae: [String(r.value)], style };
    else if (r.kind === 'lessThan') rule = { type: 'cellIs', operator: 'lessThan', formulae: [String(r.value)], style };
    else if (r.kind === 'between') rule = { type: 'cellIs', operator: 'between', formulae: [String(r.value), String(r.value2)], style };
    else continue;
    ws.addConditionalFormatting({ ref: r.sqref, rules: [rule] });
  }
  return wb;
}

function monthShort(month) {
  const [y, m] = month.split('-').map(Number);
  return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1] + ' ' + String(y).slice(2);
}
