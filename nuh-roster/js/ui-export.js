// Downloads (.xlsx, PDF, images), sending the roster out and the changes since it was sent.
import { sentRows, rosterChanges, changeText } from './engine.js';
import { buildRosterWorkbook } from './xlsxio.js';
import { buildLayout } from './layout.js';
import * as cloud from './cloud.js';
import { buildRosterPdf } from './pdfout.js';
import { buildRosterCanvas } from './pngout.js';
import { addDays } from './monthly.js';
import { download, excel, h, loadVendor, save, state, toast } from './ui-core.js';
import { dayHash, longDate, realToday, render, renderSteps } from './ui-screen.js';
import { rosterLists } from './ui-cases.js';
import { setRosterView } from './ui-roster.js';
import { colourCache, colourOf, shortOf } from './ui-person.js';
import { effectiveGeneral } from './ui-general.js';
import { hhmm } from './ui-myday.js';
import { commentsText } from './ui-premed.js';
import { isMember, saveRosterToCloud } from './ui-team.js';

async function exportXlsx(stamp = '') {
  colourCache.clear();
  const wb = buildRosterWorkbook(await excel(), { date: state.day.date, rows: state.roster.rows, lists: rosterLists(), general: effectiveGeneral(), box: commentsText(), colourOf, shortOf, stamp });
  const buf = await wb.xlsx.writeBuffer();
  download(`OT roster ${state.day.date}.xlsx`, new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}

let jspdf = null;
async function exportPdf(stamp = '') {
  if (!jspdf) {
    try {
      await loadVendor('vendor/jspdf.umd.min.js');
    } catch { toast("Couldn't load the PDF maker (offline?). Try again, or download the .xlsx."); return false; }
    jspdf = window.jspdf.jsPDF;
  }
  colourCache.clear();
  const layout = buildLayout({ date: state.day.date, rows: state.roster.rows, lists: rosterLists(), general: effectiveGeneral(), box: commentsText(), colourOf, shortOf, stamp });
  download(`OT roster ${state.day.date}.pdf`, buildRosterPdf(jspdf, layout).output('blob'));
}

// Printing: the sheet shrinks to fit one A4 page (portrait, 10 mm margins), whatever its length.
addEventListener('beforeprint', () => {
  const t = document.querySelector('table.xl');
  if (!t) return;
  t.style.zoom = '';
  const r = t.getBoundingClientRect();
  const mm = 96 / 25.4, w = 190 * mm, hgt = 277 * mm;
  const k = Math.min(1, w / r.width, hgt / r.height) * 0.98;
  if (k < 1) t.style.zoom = String(k);
});
addEventListener('afterprint', () => { const t = document.querySelector('table.xl'); if (t) t.style.zoom = ''; });

// The sheet as an image: shared straight to WhatsApp (or any app) where the phone allows it, else downloaded.
// Returns false when nothing went out (the share sheet was closed). parts: 1 image, or 2 (calls and lists, then the
// OT rooms, each with the title and date) that stay readable when WhatsApp shrinks a tall photo.
async function exportImage(stamp = '', text = '', parts = 1) {
  colourCache.clear();
  const layout = buildLayout({ date: state.day.date, rows: state.roster.rows, lists: rosterLists(), general: effectiveGeneral(), box: commentsText(), colourOf, shortOf, stamp });
  const spans = parts === 2 && layout.otFrom ? [[[2, layout.otFrom - 1]], [[2, 5], [layout.otFrom, layout.rows]]] : [[[2, layout.rows]]];
  const files = [];
  for (const [i, sp] of spans.entries()) {
    const blob = await new Promise(ok => buildRosterCanvas(layout, 1400, sp).toBlob(ok, 'image/png'));
    files.push(new File([blob], `OT roster ${state.day.date}${spans.length > 1 ? ` (${i + 1} of ${spans.length})` : ''}.png`, { type: 'image/png' }));
  }
  if (navigator.canShare?.({ files })) {
    try { await navigator.share({ files, title: `OT roster ${longDate(state.day.date)}`, ...(text ? { text } : {}) }); return true; }
    catch (e) { if (e?.name === 'AbortError') return false; }
  }
  for (const f of files) download(f.name, f);
  if (text) { try { await navigator.clipboard.writeText(text); } catch { /* no clipboard */ } }
  const what = files.length > 1 ? `${files.length} images downloaded` : 'Image downloaded';
  toast(text ? `${what} and the changes copied: paste them under the image on WhatsApp.` : `${what}. Send ${files.length > 1 ? 'them' : 'it'} on WhatsApp as a photo or file.`);
  return true;
}

// Download button: the format last picked (remembered in this browser), with a menu to change it.
// a download or print counts as the day being sent out (the steps strip shows it until the roster changes)
// A sheet sent again after changes says "Updated hh:mm" at the top; re-sending the same version keeps its stamp.
function stampForSend() {
  const s = state.outSent?.[state.day.date];
  if (!s) return '';
  return s.hash === dayHash() ? s.stamp || '' : `Updated ${hhmm(Date.now())}`;
}
// Record what went out (only once it did), so the roster can show what changed since.
function markSent(stamp) {
  const date = state.day.date;
  (state.outHash ||= {})[date] = dayHash();
  const sent = state.outSent ||= {};
  sent[date] = { hash: dayHash(), at: Date.now(), stamp, rows: sentRows(state.roster.rows) };
  const cut = addDays(realToday(), -30);
  for (const d of Object.keys(sent)) if (d < cut) delete sent[d];
  save(); renderSteps(); render();
}
const sentOut = fn => async () => {
  const stamp = stampForSend();
  let ok;
  try { ok = await fn(stamp); } catch (e) { console.error(e); toast("Couldn't make the file. Try again."); return; }
  if (ok !== false) markSent(stamp);
};
// The rooms that changed since the roster was last sent, with a way to send the changes.
export function changesCard() {
  const r = state.roster, s = state.outSent?.[state.day.date];
  if (!r || !s || s.hash === dayHash()) return null;
  const list = rosterChanges(s.rows, r.rows);
  if (!list.length) return null;
  const text = `OT roster ${longDate(state.day.date)}, changes since ${hhmm(s.at)}:\n` + list.map(c => '• ' + changeText(c)).join('\n');
  return h('section', { class: 'card changes', id: 'changes' },
    h('h2', {}, `Changed since sent at ${hhmm(s.at)} (${list.length})`),
    h('ul', { class: 'changes-list' }, list.map(c => h('li', {}, h('b', {}, `${c.label} ${c.what}: `), c.from || '(none)', ' → ', c.to || '(none)'))),
    h('div', { class: 'bar' },
      h('button', { class: 'small primary', onclick: async () => { const stamp = stampForSend(); if (await exportImage(stamp, text) !== false) markSent(stamp); } }, 'Send image with the changes'),
      h('button', { class: 'small', onclick: async () => { try { await navigator.clipboard.writeText(text); toast('Changes copied.'); } catch { toast("Couldn't copy here."); } } }, 'Copy the changes')),
    h('p', { class: 'hint' }, 'The sheet you send now says "Updated" with the time, so it can be told apart from the first one.'));
}
export const DOWNLOADS = [['xlsx', 'Download .xlsx', sentOut(exportXlsx)], ['pdf', 'Download PDF', sentOut(exportPdf)], ['png', 'Image for WhatsApp', sentOut(exportImage)], ['png2', 'Image in 2 parts (easier to read on a phone)', sentOut(stamp => exportImage(stamp, '', 2))], ['print', 'Print', sentOut(() => { setRosterView('sheet'); render(); setTimeout(() => window.print(), 100); })]];
let downloadMenu = false;
export function downloadButton() {
  let pick = 'xlsx';
  try { pick = localStorage.getItem('nuh-roster-download') || 'xlsx'; } catch { /* no storage */ }
  // members: one step to save the roster for the team and then send the image
  const all = cloud.enabled && isMember() ? [...DOWNLOADS, ['saveimage', 'Save for the team, then image', async () => {
    await saveRosterToCloud();
    if (state.cloudHash?.[state.day.date]?.hash === dayHash()) await sentOut(exportImage)();
  }]] : DOWNLOADS;
  const cur = all.find(d => d[0] === pick) || all[0];
  return h('div', { class: 'split' },
    h('button', { onclick: () => cur[2]() }, cur[1]),
    h('button', { class: 'caret', 'aria-label': 'Other formats', 'aria-expanded': String(downloadMenu), onclick: () => { downloadMenu = !downloadMenu; render(); } }, '▾'),
    downloadMenu ? h('div', { class: 'menu' }, all.map(([k, label, fn]) => h('button', { class: k === cur[0] ? 'on' : '', onclick: () => {
      if (k !== 'print') { try { localStorage.setItem('nuh-roster-download', k); } catch { /* no storage */ } }
      downloadMenu = false; render(); fn();
    } }, label))) : null);
}
