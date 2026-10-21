// A sheet model from sheetgen.js as the body of one Google Sheets API `spreadsheets.create` call: every cell with its value
// or formula and look, the frozen corner, merged cells, column widths and the colour rules. Pure (no network): gsheets.js
// `createSpreadsheet` sends it. Formulas go in as formulaValue, so Google reads them as formulas.
import { colIndex } from './sheetgen.js';

const rgb = hex => { const h = String(hex).replace('#', ''); return { red: parseInt(h.slice(0, 2), 16) / 255, green: parseInt(h.slice(2, 4), 16) / 255, blue: parseInt(h.slice(4, 6), 16) / 255 }; };
const serial = iso => { const [y, m, d] = iso.split('-').map(Number); return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000); };
const px = w => Math.round(w * 7 + 5);

const split = a => { const m = /^([A-Z]+)(\d+)$/.exec(a); return { row: Number(m[2]) - 1, col: colIndex(m[1]) - 1 }; };
const grid = (sheetId, ref) => {   // 'D7:AH12' or 'D7'
  const [a, b] = ref.split(':'); const s = split(a), e = split(b || a);
  return { sheetId, startRowIndex: s.row, endRowIndex: e.row + 1, startColumnIndex: s.col, endColumnIndex: e.col + 1 };
};

export function toSpreadsheetBody(model, { title, sheetName } = {}) {
  const sheetId = 0;
  let maxRow = 0, maxCol = 0;
  const at = new Map();
  for (const [addr, c] of model.cells) { const p = split(addr); maxRow = Math.max(maxRow, p.row); maxCol = Math.max(maxCol, p.col); at.set(`${p.row}:${p.col}`, c); }
  const rows = [];
  for (let r = 0; r <= maxRow; r++) {
    const values = [];
    for (let c = 0; c <= maxCol; c++) {
      const cell = at.get(`${r}:${c}`);
      if (!cell) { values.push({}); continue; }
      const out = {};
      if (cell.f) out.userEnteredValue = { formulaValue: '=' + cell.f };
      else if (cell.v && cell.v.date) out.userEnteredValue = { numberValue: serial(cell.v.date) };
      else if (typeof cell.v === 'number') out.userEnteredValue = { numberValue: cell.v };
      else if (cell.v != null && cell.v !== '') out.userEnteredValue = { stringValue: String(cell.v) };
      const st = cell.style || {}, fmt = {};
      if (st.fill) fmt.backgroundColor = rgb(st.fill);
      if (st.center) { fmt.horizontalAlignment = 'CENTER'; fmt.verticalAlignment = 'MIDDLE'; }
      fmt.textFormat = { fontFamily: 'Arial', fontSize: st.size || 8, bold: !!st.bold };
      if (st.numFmt) fmt.numberFormat = { type: 'DATE', pattern: st.numFmt };
      out.userEnteredFormat = fmt;
      values.push(out);
    }
    rows.push({ values });
  }
  const columnMetadata = [];
  for (let c = 0; c <= maxCol; c++) columnMetadata.push({ pixelSize: px(model.widths[c + 1] || 4) });
  const num = v => ({ userEnteredValue: String(v) });
  const conditionalFormats = model.cf.map(r => {
    const format = { backgroundColor: rgb(r.fill) };
    if (r.font) format.textFormat = { foregroundColor: rgb(r.font) };
    let condition;
    if (r.kind === 'equals') condition = { type: 'TEXT_EQ', values: [num(r.text)] };
    else if (r.kind === 'greaterThan') condition = { type: 'NUMBER_GREATER', values: [num(r.value)] };
    else if (r.kind === 'greaterOrEqual') condition = { type: 'NUMBER_GREATER_THAN_EQ', values: [num(r.value)] };
    else if (r.kind === 'lessThan') condition = { type: 'NUMBER_LESS', values: [num(r.value)] };
    else condition = { type: 'NUMBER_BETWEEN', values: [num(r.value), num(r.value2)] };
    return { ranges: r.sqref.split(' ').map(x => grid(sheetId, x)), booleanRule: { condition, format } };
  });
  return {
    properties: { title: title || `NUH junior roster ${model.month}` },
    sheets: [{
      properties: { sheetId, title: sheetName || `1 - ${model.days} ${model.month} Request`, gridProperties: { rowCount: maxRow + 1 + 5, columnCount: maxCol + 1, frozenRowCount: model.freeze.row, frozenColumnCount: model.freeze.col } },
      data: [{ startRow: 0, startColumn: 0, rowData: rows, columnMetadata }],
      merges: model.merges.map(m => grid(sheetId, m)),
      conditionalFormats,
    }],
  };
}
