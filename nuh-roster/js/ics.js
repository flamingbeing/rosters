// Calendar files (.ics) built in the browser: one all-day event per day, so a roster can be kept in a phone's
// calendar. events: [{ date: '2026-10-14', title, details, uid }]. Nothing is sent anywhere.
const esc = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const ymd = date => date.replace(/-/g, '');
const next = date => { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
// lines over 75 octets are folded (RFC 5545): counted in UTF-8 bytes, never splitting a character
const enc = new TextEncoder();
const fold = line => {
  const out = []; let cur = '', bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.map((l, i) => (i ? ' ' : '') + l).join('\r\n');
};

export function buildIcs(events, { now = new Date() } = {}) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//NUH Roster//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${esc(e.uid)}`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${ymd(e.date)}`, `DTEND;VALUE=DATE:${ymd(next(e.date))}`,
      `SUMMARY:${esc(e.title)}`, ...(e.details ? [`DESCRIPTION:${esc(e.details)}`] : []), 'TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
