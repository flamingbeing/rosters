// Write a monthly sheet for made-up people with js/sheetgen.js, to try it in Excel / Google Sheets or to verify it:
//   node nuh-junior-monthly/tools/sheetgen-demo.mjs 2026-12 14     (month, number of people; needs `npm i exceljs` somewhere resolvable)
import { createRequire } from 'node:module';
import { buildSheet, daysIn, weekdayOf } from '../js/sheetgen.js';
import { toWorkbook } from '../js/sheetgen-xlsx.js';

const ExcelJS = createRequire(process.cwd() + '/')('exceljs');
const month = process.argv[2] || '2026-12', count = Number(process.argv[3] || 14);
const grades = ['HOD', 'SC', 'AC', 'R', 'R', 'RES1', 'RES1', 'RES2', 'RES3', 'NHG', 'MOPEX', 'RR', 'Fellow', 'Fellow', 'RES1', 'RES2', 'RES3', 'R', 'LOC', 'HC'];
const n = daysIn(month);
const people = Array.from({ length: count }, (_, i) => {
  const days = {};
  for (let d = 1; d <= n; d++) if (weekdayOf(month, d) % 6 === 0) days[d] = 'WE';
  days[3 + (i % 5)] = ['R1', 'R2', 'R3', 'R1B', 'C3', 'S1', 'OGN', 'ICU', 'AL', 'X/NP'][i % 10];
  return { grade: grades[i % grades.length], name: 'Person ' + (i + 1), days, next: 'Z' };
});
const out = `/tmp/sheetgen-${month}-${count}.xlsx`;
await toWorkbook(buildSheet({ month, people }), ExcelJS).xlsx.writeFile(out);
console.log('written', out);
