# NTF Roster: build spec

The contract every module of `ntf-roster/` is built to. NTF = Ng Teng Fong General Hospital (NTFGH), Department of
Anaesthesia. The app plans the **monthly duty roster** (calls, PM shifts, clinics…) together with **leave and
requests**, on one grid like the department's "ALL STAFF LEAVE REQUEST" sheet, checks it against **rules the owner
edits in the app at any time**, and can **fill it automatically** (solver).

Public repo: never commit real names, rosters or leave. Demo and tests use made-up names only.

## Where and how

- Folder `ntf-roster/`, served at `https://ntfroster.anawj.com/` (own subdomain: it saves data). Static, no build step,
  vanilla ES modules, no framework. Every page has `<meta name="robots" content="noindex, nofollow">`.
- Works on phone (390 px) and laptop. Phone: bottom tab bar, bottom sheets. Laptop: top tabs, side panels, popovers.
- Design: NUHS tokens (`<link rel="stylesheet" href="css/tokens.css">`), Open Sans, navy `#002f6c`; the top
  band is four equal quarters orange `#e57200`, red `#e4002b`, blue `#178fd7`, navy `#002f6c`. Focus rings navy
  (`--n-focus`). Light theme. Quality bar: QGenda / Amion / Lightning Bolt / RosterLab / Deputy (colour-coded duty
  chips, sticky grid, request layer, live rule checks, fairness counts, one-click auto-fill with preview).
- Storage: `localStorage` key `ntf-roster-v1` (demo: `ntf-roster-demo`). Demo = `?demo` (made-up department; never
  signs in). Optional Firebase team sync (inactive until `js/firebase-config.js` is filled).
- Accessibility: WCAG AA (axe clean), keyboard reachable grid, labelled controls, 44 px touch targets on phone.

## Files and owners

| File | What | Built by |
|---|---|---|
| `js/model.js` | state shape, defaults, date utils, cell helpers, code sets, migration | A |
| `js/rules.js` | rule type registry, describe, validate, evaluate (full + incremental), violations | A |
| `js/solver.js`, `js/solver-worker.js` | auto-fill (pure function + Web Worker wrapper) | A |
| `test/rules.test.mjs`, `test/solver.test.mjs` | node unit tests (`node ntf-roster/test/x.test.mjs`, plain `node:assert`) | A |
| `index.html`, `style.css`, `js/app.js`, `js/store.js` | shell, router, header, toasts, sheets, store + undo | C |
| `js/ui-roster.js` | month grid, cell editor, paint mode, phone views, auto-fill dialog | C |
| `js/ui-day.js` | one day: who is on what, away, problems (phone default) | C |
| `js/ui-rules.js`, `css/rules.css` | rule list, schema-driven rule builder, templates, rule log, rules import/export | B |
| `js/rules-text.js`, `test/rules-text.test.mjs` | rules as plain sentences: Edit as text lines, the readable rules file, `TEXT_FORMS` | integration |
| `js/ui-people.js` | staff list, groups, tags, duty codes editor | B |
| `js/ui-check.js` | problems list by rule, fairness table, coverage table | B |
| `js/io.js`, `vendor/exceljs.min.js` | Excel import/export (department sheet layout), JSON backup, ICS, CSV | D |
| `js/demo.js` | made-up department and months | D |
| `js/rotations.js`, `js/people-pull.js` | rotations from APMES People: read the text, plan and apply (pure), and the pull from People | D |
| `js/ui-more.js` | Import/Export/Backup, Settings (dept name, public holidays), app version lines, team panel slot | D |
| `test/io.test.mjs` | node test of the Excel parser on a generated sheet with fake names | D |
| `js/cloud.js`, `js/firebase-config.js`, `firestore.rules`, `test/rules.emulator.mjs`, `js/ui-team.js` | team sync | E |
| `sw.js`, `manifest.webmanifest`, `icons/*`, `js/version.js` | installable/offline app, app version helper | E |
| `test/e2e.mjs`, `NOTES.md`, `README.md`, `STATUS.md` | browser test, docs | integration |

The first version was built by five builders (A to E) in parallel against this spec, then integrated (15 Oct 2026).
The owners column now just says which part a file came from; anyone may change any file, and this spec is kept in
step with the code ("As built" at the end lists what the code adds to it).

## State (`ntf-roster-v1`)

```js
state = {
  v: 1,
  settings: { dept: 'NTFGH Department of Anaesthesia', holidays: { '2026-11-08': 'Deepavali' },
              onboarding: { codes: true, rules: true, shared: false, hidden: false, done: false } },   // optional: Getting started ticks (guide.js)
  groups: [ { id: 'cons', name: 'Senior consultants / consultants', kind: 'senior' }, … ],   // sheet order
  tags:   [ { id: 'babymo', name: 'Baby MO', help: 'New MO, never on call alone' }, … ],
  staff:  [ { id, name, short: '', group: 'mo', tags: ['babymo'], fte: 1, start: '', end: '', note: '', active: true } ],
  duties: [ { code: 'C', name: 'Call', kind: 'shift', color: '#d7263d', ink: '#fff', overnight: true, auto: true, hours: 24 }, … ],
  rules:  [ Rule, … ],
  rulesLog: [ { at: ISO, by: '', action: 'add'|'edit'|'delete'|'enable'|'disable', ruleId, name } ],  // newest last, keep 200
  months: { '2026-11': { status: 'draft'|'published', publishedAt: '', note: '' } },
  cells:  { '2026-11-03': { [staffId]: Cell } },
}
Cell = { a: ['C'], r: ['Nc'], auto: ['C'], note: '', lock: false }
// a    = assigned codes (shifts, leave, other) — what the person IS doing
// r    = requests (kind 'request' codes) — what they ASKED for
// auto = subset of a the solver put there (re-running auto-fill may change these; everything else is kept)
// lock = solver must not touch this cell at all
// empty cells are deleted (no {} left behind); empty day objects deleted
```

Dates are local ISO strings `YYYY-MM-DD`; months `YYYY-MM`. Never use `Date` UTC conversions for day maths
(use `new Date(y, m-1, d)` and local getters). Weekday 0 = Sunday … 6 = Saturday.

### Duty kinds

| kind | meaning | examples |
|---|---|---|
| `shift` | work duty | C Call, P PM shift, SMO, OTC, PHD, W, APS, Clinic, Inj, Creg |
| `leave` | away, unavailable | AL, AAL, CL, TL, EL, RS, MC, HL, ML, NPL, OIL, FCL, CCL, SPL |
| `request` | a wish, not an assignment | Cr, Nc, Wr, Nw, Pr, NP |
| `other` | away from the NTF pool or a note-like code | NUH, ICM, LT, Ether, Mtg |
| `derived` | computed, never stored: `x` = post call, the day after an `overnight` shift | x |

A duty has `auto: true` when the solver may assign it (default C, P, SMO, OTC, PHD). `overnight: true` gives `x`
the next day. Codes are case-sensitive in the app; import matches case-insensitively.

### Code tokens (used in rules)

A rule's code list may mix real codes and tokens:
`@shift` (any shift), `@leave` (any leave), `@other`, `@request`, `@away` (leave, other, or x),
`@present` (has a shift, or it's a weekday that isn't a public holiday and they aren't @away), `@any` (any code).
`x` can be listed like a code.

## model.js exports (A)

```js
export const STORE_KEY = 'ntf-roster-v1', DEMO_KEY = 'ntf-roster-demo';
export const DEFAULT_GROUPS, DEFAULT_TAGS, DEFAULT_DUTIES;     // arrays as below
export function defaultState()            // fresh state with default groups, tags, duties, DEFAULT_RULES (from rules.js), no staff
export function migrate(s)                // fill missing fields, return state
export function uid(prefix='id')          // short random id
// dates
export function iso(d) ; parseISO(s) -> Date ; addDays(s, n) -> iso ; monthDays('2026-11') -> ['2026-11-01', …]
export function monthOf(s) -> 'YYYY-MM' ; addMonths('2026-11', n) ; weekday(s) -> 0..6 ; isWeekend(s)
export function isHoliday(state, s) -> bool ; holidayName(state, s)
export function fmtDay(s) -> 'Tue 3 Nov' ; fmtMonth('2026-11') -> 'November 2026'
// lookups
export function dutyMap(state) -> Map(code -> duty) ; groupMap(state) ; staffMap(state)
export function staffActiveOn(person, s) -> bool          // active && within start/end (blank = open)
export function staffInMonth(state, m) -> person[]        // sheet order: by group order, then state order
// cells
export function getCell(state, s, staffId) -> Cell|null
export function setCell(draft, s, staffId, patch)         // merges, normalises (dedupe, auto ⊆ a), deletes when empty
export function effectiveCodes(state, s, staffId) -> string[]   // a + 'x' if previous day had an overnight shift (dedupe)
export function expandTokens(state, codes) -> Set(codes)  // tokens to concrete codes (not @present: see matchesCodes)
export function matchesCodes(state, s, staffId, codes, eff?) -> bool   // handles every token incl. @present
```

## Rules (`rules.js`, A)

Every rule is plain data. The owner adds, edits, disables and deletes rules in the app; the checker and the solver
read them. **Adding a new rule type later = one entry in `RULE_TYPES` + a unit test** (document this in docs/rules.md).

```js
Rule = {
  id, type, name: '',              // name optional; UI shows describeRule() when blank
  enabled: true, hard: true, weight: 10,      // weight 1–100 used when soft
  who:  { groups: [], tags: [], staff: [], exclude: [] },   // empty groups+tags+staff = everyone
  when: { from: '', to: '', days: [], holidays: 'any' },    // days = weekdays 0–6 (empty = all); holidays 'any'|'only'|'exclude'
  params: { … per type … },
  note: '',
}
```

`RULE_TYPES[type] = { label, icon (emoji), help, example, params: [ParamSpec], defaults() -> params, scope: 'day'|'person'|'global', soft_only?: true }`
`ParamSpec = { key, label, kind: 'codes'|'code'|'number'|'select'|'who'|'bool', options?: [[value,label]], min?, max?, optional?, help? }`

The rule builder UI (B) is generic over this metadata, so the types and their param keys below are the contract:

| type | label | params | meaning (for people in `who`, on days in `when`) |
|---|---|---|---|
| `cover` | Cover each day | `codes`, `min`(opt), `max`(opt) | number of people in who with any of codes is ≥ min and ≤ max |
| `limit` | Limit per person | `codes`, `period` ('week' Mon–Sun \| 'month' \| 'rolling'), `window` (days, rolling only), `min`(opt), `max`(opt), `fte` (bool: scale by fte), `prorate` (bool: scale by days in post) | each person's count of matching days per period |
| `sequence` | Day-after rules | `ifCodes`, `thenCodes`, `mode` ('forbid'\|'require'), `from` (offset, e.g. 1), `to` (offset) | if a person has ifCodes on day d (d in when), then on d+from…d+to they must not / must have thenCodes (negative offsets = days before) |
| `sameDay` | Same-day combinations | `codesA`, `codesB`, `mode` ('forbid'\|'require') | a person can't have A and B on the same day / A needs B |
| `together` | Pairing between people | `codes`, `other` (who), `otherCodes`, `mode` ('never'\|'needs'), `min` (needs only) | if someone in who has codes on d: never → nobody in other (except themselves) has otherCodes on d; needs → at least min people in other (not themselves) do |
| `maxRun` | Consecutive days | `codes`, `max` | no more than max consecutive days with codes |
| `requests` | Honour requests | `request` (code), `codes`, `mode` ('want'\|'avoid'), `span` ('day'\|'weekend') | someone with the request on d wants / doesn't want codes on d (weekend: on the Sat or Sun of that weekend) |
| `spread` | Share fairly (soft only) | `codes`, `period` ('month'\|'range'), `weekendWeight` (default 2), `holidayWeight` (default 2), `tolerance` (default 1) | penalty for each person whose weighted count (per fte) is more than tolerance from the group mean |
| `eligible` | Only these people | `codes` | only people in who may have codes; violation for anyone else |
| `standing` | Standing duty | `codes` | each person in who has codes on every day in when (unless @away) |

Violations: `{ ruleId, type, hard, penalty, date?, staffId?, staffIds?: [], msg }`. `msg` is plain English naming the
person (short or name) and date, e.g. "Tue 3 Nov: 1 junior on Call, needs 2".

```js
export const RULE_TYPES;
export const DEFAULT_RULES;            // see list below, with fixed ids 'r-…'
export function newRule(type, state) -> Rule
export function describeRule(rule, state) -> string     // "Each day, 2 people in Juniors on C (Call)"
export function validateRule(rule, state) -> string[]   // problems ("No codes chosen", "min > max", unknown code)
export function evaluate(state, { from, to, rules? }) -> {
  violations, hard: n, soft: n, score,                 // score = Σ penalties (hard ×1000 + soft weight)
  byCell: Map('date|staffId' -> violations[]), byDay: Map(date -> violations[]), byRule: Map(ruleId -> violations[]),
}
export function evaluateRule(state, rule, { from, to }) -> violations[]   // for the builder's live "check now"
```
Evaluating a month should take < 50 ms for 80 staff × 31 days × 20 rules. Rules see the days `from`…`to` plus up to
7 days either side for sequence / post-call context (cells outside the range count, but violations are reported
only for days inside it).

### DEFAULT_RULES (new installs and the demo; the owner tunes them)

1. `r-leave` sameDay forbid `@leave` + `@shift`, hard — "No shifts on leave"
2. `r-postcall` sameDay forbid `x` + `@shift`, hard — "Post call is a day off"
3. `r-jcall` cover `C`, juniors (groups sr, srp, rp, jr, locum, mo), min 2 max 2, hard
4. `r-scall` cover `C`, seniors (cons, ac), min 1 max 1, hard
5. `r-gap` sequence if `C` forbid `C` from 1 to 2, soft 20 — "At least 3 days between calls"
6. `r-maxcall` limit `C` month max 7, juniors, fte true, hard
7. `r-wkend` limit `C` month max 2, when days [0,6], soft 20 — "At most 2 weekend calls a month"
8. `r-fair-j` spread `C` month, juniors, soft 5; `r-fair-s` same for seniors
9. `r-req-cr` requests Cr want C day soft 10; `r-req-nc` requests Nc avoid C day hard; `r-req-wr` Wr want @shift weekend soft 5; `r-req-nw` Nw avoid @shift weekend soft 50; `r-req-pr` Pr want P soft 5; `r-req-np` NP avoid P hard
10. `r-baby` together needs: who tag babymo, codes C, other groups sr, srp, rp, ac, otherCodes C, min 1, hard — "A Baby MO on call needs a senior resident, RP or AC on call"
11. `r-baby2` together never: who tag babymo, codes C, other tag babymo, otherCodes C, hard — "Two Baby MOs never on call together"
12. `r-preleave` sequence if `C` forbid `@leave` from 1 to 1, soft 10 — "No call the night before leave"
13. `r-pm` cover `P`, juniors, days 1–5, holidays exclude, min 1 max 1, hard
14. `r-otc` eligible `OTC` who seniors (cons, ac, ext, vc), hard
15. `r-phd` cover `PHD`, juniors, holidays only, min 1 max 1, hard

## DEFAULT_GROUPS / TAGS / DUTIES (model.js)

Groups (sheet order): cons "Senior consultants / consultants" senior · ac "Associate consultants" senior · ext
"NUH / NTFGH / ICU consultants" senior · vc "Visiting consultants" senior · sr "Senior residents" junior · srp
"Senior resident physicians" junior · rp "Resident physicians" junior · jr "Junior residents" junior · locum "Locums"
junior · mo "Medical officers" junior.

Tags: babymo "Baby MO" · parttime "Part time" · pain "Pain (APS)" · icu "ICU".

Duties (code · name · kind · colour/ink · flags):
- shift: C Call `#c62828/#fff` overnight auto · P PM shift `#ef6c00/#fff` auto · SMO Stepdown MO call `#6a1b9a/#fff`
  overnight auto · OTC OT consultant `#1565c0/#fff` auto · PHD Public holiday day shift `#00838f/#fff` auto · W
  Weekend duty `#4527a0/#fff` overnight · Creg Call tag-on `#ad1457/#fff` · APS Acute pain service `#2e7d32/#fff` ·
  Clinic Clinic `#558b2f/#fff` · Inj Injection list `#827717/#fff`
- leave (all `#fde2e4/#7a1c27`, AL a touch stronger `#f8c9cf`): AL Annual leave · AAL Advance annual leave · CL
  Conference/training leave · TL Training leave · EL Exam leave · RS Reservist · MC Medical leave · HL
  Hospitalisation leave · ML Maternity leave · NPL No pay leave · OIL Off in lieu · FCL Family care leave · CCL
  Childcare leave · SPL Special leave
- request (outlined chips, colour `#0b5394`): Cr Call request · Nc No call · Wr Weekend shift request · Nw No weekend
  shift · Pr PM request · NP No PM shift
- other (`#e0e0e0/#333`): NUH At NUH · ICM ICU posting · LT Liver transplant · Mtg Meeting · Teach Teaching
- derived: x Post call `#eeeeee/#555`

## Store (`store.js`, C)

```js
export function createStore({ demo })  -> store
store.get() -> state                      // treat as read-only
store.commit(label, fn)                   // fn(draft) mutates a structuredClone; pushes undo (max 40); saves; notifies
store.replace(state, label)               // whole state (import, cloud load), undoable
store.undo(); store.redo(); store.canUndo(); store.canRedo(); store.undoLabel(); store.redoLabel()
store.subscribe(fn(state, { label, source })) -> unsubscribe
store.isDemo                              // bool
store.save()                              // localStorage; on quota error show a bar with "Download backup"
```

## App shell (`app.js`, C) — what every view gets

```js
// view modules export: mount(el, app) -> { update(state)?, unmount()? }   update is called after every store change
app = {
  store, month /* 'YYYY-MM' on screen */, setMonth(m), go(tab, params?), params /* current hash params */,
  toast(msg, { action?: { label, fn }, kind?: 'ok'|'warn'|'error', ms? }),
  sheet({ title, body /* Node */, actions: [{ label, primary?, danger?, fn }], wide? }) -> close(),
  confirm(msg) -> Promise<bool>,
  evaluation() -> evaluate() result for app.month (cached until the next store change),
  isPhone() -> bool (≤ 720 px),
  h(tag, attrs, ...children) -> Node        // tiny DOM helper: attrs with on* handlers, class, style object, aria-*
  selectedCell /* {date, staffId} | null */, selectCell(date, staffId),
}
```
Tabs (hash routes `#roster`, `#day`, `#people`, `#rules`, `#check`, `#more`; params after `?`, e.g.
`#day?d=2026-11-03`, `#roster?m=2026-11&p=staffId`). Header: app name, month picker ‹ month › (Today), undo/redo,
problems badge (hard count, opens Check), Auto-fill button. Phone: bottom tab bar (Roster, Day, Check, Rules, More;
People is inside More on phone). Keyboard: Ctrl/Cmd+Z / Shift+Z / Y, `[` `]` months, `?` shortcuts.

## Solver (`solver.js`, A)

```js
export function solve(state, { from, to, seed = 1, timeMs = 6000, onProgress }) -> {
  assignments: { [date]: { [staffId]: ['C', …] } },   // the auto codes for every non-locked cell in range (may be [])
  before: { hard, soft }, after: { hard, soft }, unfilled: [ { date, code, need } ], iterations, ms,
}
```
- Fills only duties with `auto: true`; keeps every non-auto code, every locked cell and every code not listed in a
  cell's `auto` (manual entries stay). Removes previous `auto` codes in range before starting.
- Demand comes from `cover` rules on auto codes (min). Hard rules must hold when possible; soft rules are minimised.
- Approach: greedy construction (hardest days first, candidates by least cost delta) then local search (move,
  swap between two people on the same day, swap days for one person; simulated annealing) with incremental scoring
  (re-score only the touched people and days). Deterministic for a given seed.
- `solver-worker.js`: `onmessage = { type: 'solve', state, opts }` → posts `{ type: 'progress', best: {hard, soft}, pct }`
  and finally `{ type: 'done', result }` or `{ type: 'error', message }`. The UI shows a preview (how many shifts
  changed, hard/soft before → after, unfilled) and Apply (one undo step) or Discard.

## Excel (`io.js`, D)

Import the department sheet ("ALL STAFF LEAVE REQUEST", one sheet per month, layout seen in Dec 2026 copy):
- Row with the month title in column A (`DECEMBER 2026`) and day numbers across; the first numbers can be the end of
  the previous month (29, 30) and a trailing `JAN` 1, 2 block; map each column to a real date.
- A weekday-letter row (Su M Tu W Th F S) below it.
- Section rows in capitals (SENIOR CONSULTANTS / CONSULTANTS, ASSOCIATE CONSULTANTS, NUH / NTFGH / ICU CONSULTANTS,
  VISITING CONSULTANTS, SENIOR RESIDENTS, SENIOR RESIDENT PHYSICIAN, RESIDENT PHYSICIANS, JUNIOR RESIDENTS, LOCUM,
  MEDICAL OFFICERS) map to groups; name rows (name in column A, repeated in the last column) are staff.
- Names may carry a bracket note: "Name (R4-SR1 25/5/26-13/9/26)" or "Name (B) 6/5/26-7/9/26": keep the plain name,
  put the rest in `note`, and read the dates into start/end when clear.
- Count rows ("Total Seniors At Work", "Snr Doctors 'Cr' & 'C'", "Junior Doctors…") and the MEETING REQUESTS block and
  legend at the bottom are skipped (meeting requests: optional, add as notes on the day for the named person if matched).
- Cell text → codes: split on spaces, `/`, `,`; match known codes case-insensitively (`NC`, `nc` → Nc; `CR` → Cr);
  `x` is ignored (derived); anything else (times like `3-4.30pm`, `bcls-pm`, `Clinic UG`) goes into the cell note.
- Shows a review before applying: people found (new / matched), cells per month, unknown codes (offer: add as a code
  of kind other, or keep as notes). Import is one undo step.
Export the same layout (title, month row, weekday row, sections, codes with duty colours, weekends/holidays shaded,
x shown, count rows for seniors/juniors at work, legend), one sheet per month. Also: JSON backup/restore (whole
state, `{ kind: 'ntf-roster-backup', v: 1, state }`), rules-only JSON (`{ kind: 'ntf-roster-rules', rules, duties }`),
ICS calendar for one person's month (shifts only), CSV of the month.

ExcelJS: copy `../nuh-roster/vendor/exceljs.min.js` (and its licence) into `ntf-roster/vendor/`; load it lazily with
a `<script>` tag (window.ExcelJS) only when Excel is used.

## Demo (`demo.js`, D)

`export function demoState(today = iso(new Date()))`: the default state plus a made-up department about the size of the
real one (≈ 13 cons, 6 AC, 2 ext, 3 VC, 4 SR, 2 SRP, 3 RP, 9 JR, 2 locum, 20 MO; 3 MOs tagged babymo), Singapore
public holidays for 2026–2027, this month and next with realistic leave blocks, some CL/TL, requests (Cr, Nc, Wr, Nw,
Pr, NP), a few clinics/APS weeks for seniors, meetings as notes; this month already filled by the solver-like
pattern (or left for auto-fill: leave next month empty so Auto-fill can be shown). Made-up names, mixed Chinese,
Malay, Indian and Western, never real staff.

## Team sync (E)

Firebase project `ntf-roster` (the owner creates it; until then `firebase-config.js` is empty and the app is local
only, with JSON backup). Firestore: `team/main` { groups, tags, staff, duties, rules, rulesLog, settings, updatedAt,
updatedBy }, `months/{YYYY-MM}` { cells (that month's days), status, updatedAt, updatedBy }, `months/{m}/versions/*`
(immutable copies on each save), `members/{email}` { role: 'admin'|'rosterer'|'viewer', name, staffId? },
`accessRequests/{email}`. Rules: members read; admin/rosterer write; writes stamped with the signed-in email; versions
immutable; admins manage members and can't demote themselves. Emulator test with fake accounts and project
`demo-ntf-roster`. `ui-team.js` exports `mountTeam(el, app)`: sign in/out, status, Save to team / Load from team with
conflict check (`updatedAt` seen at load), members list for admins. Demo mode never signs in.

## As built (integration, 15 Oct 2026)

What the code adds to the contract above. Keep this list in step with the code.

- **App** (`app.js`): also `app.icon(name)` (line icons as SVG strings), `app.esc`, `app.model` (model.js),
  `app.rules` (rules.js), `app.isDemo`, `app.tab`; `window.ntfApp` points at it (for the browser test and console).
  `sheet()` also takes `className` and `onClose(reason)`; an action's `fn(close)` returning `false` keeps the sheet
  open. `confirm(msg, { ok, danger })`. `toast(..., { ms: 0 })` stays until dismissed. The shell registers `sw.js`
  through `version.js`'s `registerSW()` (app-update's register.js): a new version takes over at once and the page
  reloads once, no toast.
- **Views**: mounted with `mount(host, app)` inside `.view-<tab> > .view-host`; `update(state, info)` gets
  `info.label`/`info.source` after a store change, `info.month` after a month switch, `info.resize` when the phone
  layout flips; an optional `route(params)` takes new hash params without remounting. With no staff, Roster, Day and
  Check show a welcome card instead.
- **Hash params**: `#roster?m=&p=<staffId>` (person view), `#day?d=`, `#people?s=staff|groups|tags|codes`,
  `#rules?edit=<ruleId>|new`, `#check?rule=<ruleId>&v=fairness|coverage`.
- **Store**: `createStore({ demo, fallback })` (fallback builds the first state); also `store.key`,
  `store.onSaveError` (the shell shows a bar with "Download backup") and `store.reset(fresh, label)`. A fresh or
  practice state is written to localStorage on its first change.
- **Rules**: violations may also carry `dates[]` (a run of days). `evaluate` skips disabled or broken rules;
  `evaluateRule` checks a rule even when it is off. Lower-level exports (`buildContext`, `compileRules`, `refresh`,
  `runRule`, …) are for the solver. `spread` is always soft. The default rules are stored in `model.js` and
  re-exported by `rules.js` (no circular import); there are 21 (item 8 is two rules, item 9 six).
- **Solver**: `unfilled[]` entries also carry `ruleId`; `before`/`after` also carry `score`. Options also `t0`, `t1`
  (temperatures, default 1 and 0.2), `iterations` (default 500 per unfilled slot, 12,000 to 100,000) and `patience`
  (stop once no must-fix problem is left and nothing better was found in that many tries; default 60% of the
  budget); `onProgress` is called once with the first draft (`pct: 0`) before the search. Extra exports
  `applyAssignments(draft, assignments)`, `withAssignments(state, assignments)`, `diffAssignments(state, assignments)`
  (the roster's Auto-fill dialog uses its own `applyAssignments(draft, result, days)` in `ui-roster.js`). After the
  search it drops any duty no rule needs.
- **Rule builder**: `limit.window` shows only for `period: 'rolling'`, `together.min` only for `mode: 'needs'`
  (`SHOW_IF` in `ui-rules.js`).
- **io.js**: `exportDeptWorkbook()` is async (a Promise of a Blob). Parsed workbooks also carry `meetings[]`, people
  a `key`, cells `u` (unknown codes). Extra helpers: `buildDeptWorkbook`, `parseCellText`, `parseNameCell`,
  `normName`, `fileStamp`, …
- **Team sync**: `team/main/versions/*` also keeps an immutable copy of each team save; the last team version each
  browser has seen is in localStorage `ntf-roster-team-seen` (not part of the state). `cloud.js` accepts an
  `emulator: { firestore, auth }` config field only for `demo-` projects (tests).
- **Offline app**: `sw.js` (`VERSION = 'ntf-roster-v1'`, stamped at deploy) caches the shell; ExcelJS and the
  Firebase SDK are cached on first use. `version.js`: `registerSW({ onUpdate })`, `renderVersion(el)`, `getLatest()`,
  `appVersion()`, `versionLabel()`; More ends with the two version lines.
- **First-time help (Oct 2026)**: `js/guide.js` (Getting started checklist, Help sheet, "Try it yourself") and `js/tour.js`
  (the coach-mark tour, `TOUR_STEPS`, and `showMe` spotlights). `settings.onboarding` holds only the Getting started
  ticks the data can't show (`codes`, `rules`, `shared`) plus `hidden` and `done`, all booleans (`migrate` drops anything
  else); `store.mark(patch)` sets them without an undo step (subscribers get `source: 'mark'`), and undo/redo keep the
  newer ticks. The app also has `app.onboard(key)`, `app.refreshGuide()`, `app.openAutofill()`, `app.shortcuts()`,
  `app.settled()` and `go(tab, params, { replace })`. Tour seen per device: localStorage `ntf-roster-tour`
  (`{ v, done }`); checklist folded: `ntf-roster-guide`. Controls the tour lights carry `data-tour="…"`.
- **Tests**: `test/e2e.mjs` (browser, desktop and phone, axe) and `test/tour.e2e.mjs` (first-time help) are in the Checks workflow with the unit tests.
  `test/perf.e2e.mjs` (speed budgets on a slowed phone) is run by hand.
- **Speed (Oct 2026)**: the grid patches changed cells and draws full redraws progressively (`NOTES.md`, Speed); a
  spacer row `tr.r-spacer` can sit at the top of the grid's body for a few frames, and `flushRows()` draws whatever
  is still to come. The rule builder's live check runs once per frame after a change (was a 120 ms pause).
- **Review fixes (15 Oct 2026)**: `sheet()` also takes `beforeClose(reason)` (may return a Promise of false to keep the
  sheet open when closed by Back, Esc, the X or the backdrop) and adds a history entry so Back closes it.
  `evaluate()` also returns `failed[]` (ids of enabled rules it couldn't check); the shell's evaluation carries
  `error: true` when the whole check threw. `buildContext(state, { from, to, rules })` widens by `ruleReach(rules)`.
  `rules.js` also exports `normalizeWho`, `normalizeWhen`; `model.js` exports `cleanRule`, `cleanDuty`, `DUTY_KINDS`
  (used by `migrate`, rules import and `parseRulesJSON`). Whole-month violations (spread, a monthly minimum) carry
  `month` and no `date`. Store: `store.damaged` (`{ raw, key }` when the saved copy couldn't be read; saving waits),
  `store.clearDamaged()`, a revision counter in `<key>-rev`, and `info.source === 'external'` when another tab saved.
