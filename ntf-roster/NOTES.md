# NTF Roster: notes

What the app is, what we know about the NTF anaesthesia department's monthly roster, how the app is built and the
decisions behind it. Read this before changing `ntf-roster/`. `SPEC.md` is the module contract (state shape, exports,
rule types); What is happening now is kept outside this repo.

The repo is public: never commit real staff names, rosters, leave or the department's sheets. Demo and tests use
made-up names only.

## What it is

The monthly duty roster of the Department of Anaesthesia, Ng Teng Fong General Hospital (NTFGH): calls, PM shifts,
clinics and other duties together with leave and requests, on one grid like the department's "ALL STAFF LEAVE
REQUEST" sheet (staff by grade group down the side, days across). It checks the roster against **rules the owner adds
and edits in the app at any time** (the owner's main ask: rules and combination restrictions keep changing after
launch) and can **fill the calls and shifts automatically** (Auto-fill).

- Address: <https://ntfroster.anawj.com/> (own subdomain because it saves data; `worker/routes.js` maps it to
  `ntf-roster/`). Practice with a made-up department: <https://ntfroster.anawj.com/?demo>.
- Static, vanilla ES modules, no build step, no framework. Phone (390 px) and laptop.
- Reference products for the quality bar: QGenda, Amion, Lightning Bolt, RosterLab, Deputy (colour-coded duty
  chips, sticky grid, request layer, live rule checks, fairness counts, one-click auto-fill with preview).

## The department (the owner confirms)

### Groups (sheet order)

| id | Section on the sheet | Kind |
|---|---|---|
| `cons` | SENIOR CONSULTANTS / CONSULTANTS | senior |
| `ac` | ASSOCIATE CONSULTANTS | senior |
| `ext` | NUH / NTFGH / ICU CONSULTANTS | senior |
| `vc` | VISITING CONSULTANTS | senior |
| `sr` | SENIOR RESIDENTS | junior |
| `srp` | SENIOR RESIDENT PHYSICIAN(S) | junior |
| `rp` | RESIDENT PHYSICIANS | junior |
| `jr` | JUNIOR RESIDENTS | junior |
| `locum` | LOCUM / LOCUMS | junior |
| `mo` | MEDICAL OFFICERS | junior |

Tags (app-only labels): `babymo` Baby MO (a new MO, never on call alone), `parttime`, `pain` (APS), `icu`.

### Codes

Kinds: **shift** (work), **leave** (away), **request** (a wish, not an assignment), **other** (away from the NTF pool,
or note-like), **derived** (worked out, never stored).

| Code | Meaning | Kind | Notes |
|---|---|---|---|
| C | Call | shift | overnight (gives x next day); auto-filled |
| P | PM shift | shift | auto-filled |
| SMO | Stepdown MO call | shift | overnight; auto-filled |
| OTC | OT consultant | shift | **guess** at the meaning; auto-filled; seniors only (rule `r-otc`) |
| PHD | Public holiday day shift | shift | auto-filled; 1 junior on each public holiday is a **guess** |
| W | Weekend duty | shift | **guess** at the meaning; overnight assumed |
| Creg | Call tag-on | shift | **guess** at the meaning |
| APS | Acute pain service | shift | |
| Clinic, Inj | Clinic, injection list | shift | |
| AL, AAL, CL, TL, EL, RS, MC, HL, ML, NPL, OIL, FCL, CCL, SPL | Annual, advance annual, conference/training, training, exam, reservist, medical, hospitalisation, maternity, no pay, off in lieu, family care, childcare, special leave | leave | |
| Cr, Nc, Wr, Nw, Pr, NP | Call request, no call, weekend shift request, no weekend shift, PM request, no PM shift | request | |
| NUH, ICM, LT, Mtg, Teach | At NUH, ICU posting, liver transplant, meeting, teaching | other | |
| x | Post call | derived | the day after an overnight shift; never stored, ignored on import |

Some codes seen on the sheets have meanings nobody has confirmed; the importer offers to add them as kind "other" or keep them as notes (which codes: details in the owner's private notes).

### Numbers the default rules guess

2 juniors and 1 senior on call each night; 1 PM shift each weekday that isn't a public holiday; at most 7 calls a
month for a junior (scaled by FTE); at most 2 weekend calls a month (soft); at least 3 days between calls (soft);
1 PHD on public holidays. All are ordinary rules the owner can change in the Rules tab.

## Data model

One state object, saved in `localStorage` (`ntf-roster-v1`; practice: `ntf-roster-demo`). Full shape in `SPEC.md`.

- `staff` (with group, tags, FTE, start/end dates, active), `groups`, `tags`, `duties` (the codes, with kind,
  colours, `overnight`, `auto`), `rules`, `rulesLog`, `settings` (department name, public holidays), `months`
  (status), `cells`.
- A cell is `{ a, r, auto, note, lock }`: `a` what the person is doing (assigned codes), `r` what they asked for
  (requests), `auto` the part of `a` Auto-fill placed (re-running it may change those; everything else stays), `lock`
  (Auto-fill never touches the cell). Empty cells and empty days are deleted, so the state stays small.
- Post call (`x`) is derived from an `overnight` code the day before, never stored.
- Dates are local `YYYY-MM-DD` strings; never UTC conversions.
- A practice or fresh state is saved on its first change (until then a reload rebuilds it).

## Rules engine (`js/rules.js`)

Every rule is plain data: `{ id, type, name, enabled, hard, weight, who, when, params, note }`. `who` picks people
(groups, tags, named people, except); `when` picks days (from/to, weekdays, public holidays any/only/exclude). Hard
rules must hold (each break costs 1000); soft rules (preferences) cost their weight (1 to 100).

Ten types, all in `RULE_TYPES`: **cover** (how many people on a code each day), **limit** (per person per week,
month or rolling window, optionally scaled by FTE or days in post), **sequence** (day-after rules: if X then not / must
Y on the next days, or days before), **sameDay** (combinations on one day), **together** (pairing between people:
never together / needs someone), **maxRun** (consecutive days), **requests** (honour a request code, by day or
weekend), **spread** (share fairly; always soft), **eligible** (only these people may have a code), **standing**
(a fixed duty on given weekdays). Code lists may use tokens: `@shift`, `@leave`, `@other`, `@request`, `@away`
(leave, other or post call), `@present` (a shift, or a normal weekday and not away), `@any`, and `x`.

How it checks: `evaluate()` builds a grid of effective codes for the month plus a week either side, or further when a
rule reaches further back (`ruleReach`: the longest day-after offset, rolling window or run) (bit flags per
person-day, so token tests are one AND), compiles each enabled rule into a small evaluator (per day, per person or
global), and collects violations with plain-English messages ("Tue 3 Nov: 1 junior on Call, needs 2"). A month of
80 staff × 31 days × 23 rules takes about 5 to 10 ms, so the app re-checks on every edit. Requests count as codes when
rules are checked (a rule on `Nc` matches people who asked for no call), and post call counts as away (a `standing`
rule is met on a post-call day).

Edges of the month (review, 15 Oct 2026): only what can be changed inside the dates checked counts. Last month's
excess over a week or rolling limit is last month's problem; a minimum for a week or window running into next month's
unplanned days is scaled down (rounded down); a weekend request on Sat 31 Oct covers Sun 1 Nov; a call on the 30th
before a clinic already planned on the 1st is flagged in this month (post call). One duty over a rolling limit costs
one unit however many windows it sits in. Problems about a person's whole month (fair share, a monthly minimum) have
no date: the grid marks the name with a dot and Check's Show opens their month. A rule that can't be checked (a
damaged rule from a file) is skipped and listed (`evaluate().failed`), and the header says "Rule check failed" rather
than "No problems" if the check itself breaks. Rules and duty codes from files, backups and the team are cleaned on the
way in (`cleanRule`, `cleanDuty`, `migrate`).

### How to add a new rule type (step by step)

Do this only when the owner wants a kind of rule that none of the ten types can express (most new rules are just a
new rule of an existing type, made in the app). The comment block at the top of `js/rules.js` is the reference.

1. **Name it.** Pick a short camelCase type key (e.g. `minGap`) and the plain-English label the builder shows.
2. **Add one entry to `RULE_TYPES` in `js/rules.js`**, next to a similar type to copy from (`maxRun` is a short
   person-scoped example; `cover` a day-scoped one; `spread` a global one):
   - `label`, `icon` (an emoji), `help`, `example`: the words on the "Add rule" picker.
   - `params`: the form, as a list of ParamSpecs (`{ key, label, kind, options?, min?, max?, optional?, help? }`
     with kind `codes`, `code`, `number`, `select`, `who` or `bool`; the `P.codes`, `P.num` and `P.sel` helpers make
     the common ones). The rule builder (`js/ui-rules.js`) draws its form from this list, so no UI code
     is needed. A param that only matters for some settings can be hidden with an entry in `SHOW_IF` in `ui-rules.js`.
   - `defaults()`: a fresh params object.
   - `scope`: `'day'`, `'person'` or `'global'` (what one evaluation covers; the solver re-checks only what a change
     touches). `soft_only: true` if it can never be hard.
   - `describe(rule, T)`: one short sentence, using `T.codes()`, `T.who()` and `withWhen()` like the others.
   - `validate(rule, state)` (optional): problems beyond the generic checks ("At most must be 1 or more").
   - `compile(rule, X)`: returns an evaluator with `day(d, out)`, `person(p, out)` or `global(out)` that returns the
     penalty (`X.u` per unit), bumps `X.ctx.n2` per violation, and only when `out` is given pushes
     `X.V(pen, msg, { date, staffId, dates?, staffIds? })`. Return `null` when the rule can't apply (no codes).
     Report only days between `ctx.lo` and `ctx.hi` (the month on screen); the days around it are context.
3. **Test it** in `test/rules.test.mjs`: a passing and a failing case, the `describeRule` sentence, and a
   `validateRule` case. Run `node ntf-roster/test/rules.test.mjs`, then `node ntf-roster/test/solver.test.mjs`.
4. **Check it in the browser**: Rules › Add rule shows the new card; build one in `?demo` and see its problems in the
   grid and in Check. If Auto-fill should be able to satisfy it (not just score it), check `js/solver.js` step 2: only
   `cover`, `standing` and minimum `limit` rules create demand; everything else is scored.
5. **Give it a sentence**: one entry in `TEXT_FORMS` in `js/rules-text.js` (the words for Edit as text and the
   readable file; `test/rules-text.test.mjs` fails until there is one), and a case in that test's list.
6. **Document it**: one line in the rule-type list above and in the table in `SPEC.md`.

Nothing else changes: the checker, the builder, Check and the solver all read `RULE_TYPES`.

## Sharing rules as text (`js/rules-share.js`)

Rules > Copy puts the rules (JSON, same shape as the Export file) on the clipboard; Paste / import takes pasted text or a
file, accepts the export shape, a bare list, one rule, or a Claude reply with the JSON in a code block, and opens the
review: plain-English problems per rule (unknown type or code; those are not importable), a dry run (how many problems
the rule would flag this month as the roster is now), New / Changed / same. A rule without `pool` goes to the roster in
view. "Guide for Claude" copies a Markdown guide built from `RULE_TYPES` (every type, field and option) plus this
roster's codes, groups and tags (no staff names), so a new rule type appears in it by itself. Priorities: select by type,
clear selection, saved selections (per device, `ntf-roster-rq-sets`).

## Auto-fill (`js/solver.js`, `js/solver-worker.js`)

A pure function run in a Web Worker (the page stays responsive; it falls back to the page if the worker fails). It
places only duties marked `auto` (default C, P, SMO, OTC, PHD), never touches locked cells, manual codes, leave or
requests, and clears only its own earlier codes in the month. Demand comes from `cover` rules on auto codes.
`opts.codes` fills only some codes (the result's `codes` says which; `applyAssignments` then leaves other auto codes
alone). The dialog remembers (per device, `ntf-roster-af-pref`) which codes, whether to assign the free APS weeks first
(written in the same undo step as the fill), and "Apply when done" (on by default: it applies itself only when no rule
is unmet and nothing is short; otherwise it shows the result). The month last seen on a device is reopened
(`ntf-roster-ui-month`); the Junior/Senior choice already lives in the device's own state.
Greedy construction (hardest slots first), then simulated annealing with incremental scoring (moves, swaps, add and
drop), then it drops any duty no rule needs. Hard problems always come first: a move's hard change is scaled far
above any soft change, and the best roster is the one with the fewest hard points, then the fewest soft, so no
preference can buy a must-fix problem. An overnight duty is never placed the day before a fixed code that can't go with
post call. Deterministic for a seed: the search length is a budget of tries (500 per unfilled slot, 12,000 to
100,000, from a cool start, T0 1), and it ends early once it has converged (no must-fix problems left and nothing
better in the last 60% of the budget); the time option (3, 6 or 15 s) is only an upper bound for a slow phone. Tuned on
four practice departments (Oct 2026): the same quality as the first version's 1,500 tries per slot from T0 25, in a
third of the tries. On the practice department, November's 82 must-fix problems go to 0 in about 0.6 s on a laptop.
The dialog shows the first draft's counts at once. The preview shows shifts added and removed, must-fix and soft counts
before and after, and anything unfilled; Apply is one undo step.

## Speed and walkthrough

How the app stays quick on a phone, and the first-time help (checklist, tour, practice tasks), are in [docs/speed.md](docs/speed.md) and [docs/walkthrough.md](docs/walkthrough.md).

## Screens

Roster (the grid: cell editor as a popover on laptops and a bottom sheet on phones, paint mode for leave blocks,
keyboard entry, person view, coverage rows, fairness counts), Day (phone default: who is on what, away, requests,
notes, problems), People (staff, groups, tags, duty codes), Rules (list, schema-driven builder with a live check,
templates, rules log, rules JSON), Check (problems by rule, fairness, coverage), More (Excel import with a review,
Excel/PDF/CSV/ICS export, backup and restore, settings and public holidays, team sharing, the app version lines).

Hash routes (the month comes from `m`, else from `d`; changing month writes `m` into the link):
`#roster?m=2026-11&p=<staffId>`, `#day?d=2026-11-03`, `#people?s=staff|groups|tags|codes`,
`#rules?edit=<ruleId>|new`, `#check?rule=<ruleId>&v=fairness|coverage`, `#more`.

## Excel (`js/io.js`)

Import reads the department sheet: the month row in column A (`DECEMBER 2026`) with day numbers across, including the
end of the month before and a trailing `JAN` block, mapped to real dates; section rows map to groups; names matched
ignoring case, spaces and titles; count rows, the legend and the MEETING REQUESTS block skipped (meetings become day
notes). For the people and months in the sheet, leave, requests and other codes come from the sheet; shifts already
planned in the app stay unless the sheet has a shift that day; dates from the neighbouring months only fill empty
cells. A review sheet shows people (matched or new), cells per month and unknown codes before anything changes, and
Apply is one undo step. Export writes the same layout (one sheet per month, whole weeks, colours, x after calls,
counts, legend); exporting and re-importing gives the same cells (the browser test checks it). ExcelJS is loaded
only when Excel is used.

## Rotations from APMES People (`js/rotations.js`, `js/people-pull.js`)

More › Pull rotations from APMES People… opens People (`people/?pull=ntf#rotations`, the real app on the same host in tests
and previews). People says hello, this app answers `ntf-pull-info` (its names, the Mondays of the month's weeks, the month);
the user links sheet names to roster names there once and taps Send, and the text lands in a review (More › Paste rotations…
takes the same text by hand). One word per person per week: `NTF` (posted here: nothing to mark), `NUH`, `KKH`, `TTSH`,
`OTH` (posted at another hospital) and the leave codes `AL`, `ML`, `NPL`, `NS` (national service; from SAF on the sheet).
Only the month on screen, weekdays, not public holidays, from the person's start date, and not where the person already has
a leave or away code (the department sheet wins); shifts stay. Codes the roster lacks (`KKH`, `TTSH`, `OTH`, `NS`) are added as
kind "other" on Apply. Apply is one undo step. People leaves out exam weeks and OG1/OG2 (owner, 18 Oct 2026). Both ends check
the origin; the roster never reads APMES data itself. Tests: `test/rotations.test.mjs`, `test/e2e.mjs` (the pull through
the real People app).

## Storage, practice and team sharing

- Local first: everything lives in this browser until team sharing is switched on; Backup (JSON) moves it.
- Two tabs (or the installed app and a tab) share one saved copy: each save bumps `<key>-rev`, a tab never saves over
  a newer revision, and another tab's save reloads this one ("Updated with changes from another tab"). A saved copy
  that can't be read is kept as `<key>-damaged-<date>` and nothing is saved over it until the person chooses (bar:
  Download damaged copy / Start again).
- `?demo` is the practice department (`js/demo.js`): 65 invented people, leave, requests, clinics, APS weeks and
  meetings for this month and next; this month filled with no must-fix problems, next month left for Auto-fill. It
  never signs in and saves under its own key.
- Team sharing (`js/cloud.js`, `js/ui-team.js`, `firestore.rules`): off until `js/firebase-config.js` is filled. Then
  Google sign-in; `team/main` holds staff, codes, rules and settings, `months/{YYYY-MM}` one month's cells (a JSON
  string, as in NUH junior monthly: a map of cells can pass Firestore's index-entry limit). Save to cloud sends the team
  copy and every month whose fingerprint changed, in one transaction; Pull brings every month. The header's cloud button
  (`js/cloudstate.js`, per device) shows saved, not saved or cloud newer, and opens the panel; a quiet check runs once a
  minute at most once the cloud has been used here. The pool switch does not count as a change. Every save
  checks nobody else saved since you loaded (conflict: pull theirs, save anyway, or, when the view is one pool, merge:
  `J.mergeByPool` keeps this browser's pool's people, shifts and rules only about them, takes theirs for the rest, then
  saves) and keeps a permanent copy
  (`versions`). The rules allow only `{ email, name }` stamps with the saver's own email (the app shows the email
  beside the name) and no save times more than 10 minutes in the future. Members are admin, rosterer (both save) or viewer (reads). Rules tested in the emulator
  (`tools/test-rules.sh`, project `demo-ntf-roster`). `team/main` also carries `aps` (the APS week tally); the pool you
  look at (`settings.pool`) stays in each browser. The rules deploy on merge (matrix entry in
  `deploy-firestore-rules.yml`).
- Installable and offline (`sw.js`, `manifest.webmanifest`); More ends with the app version and "Get the latest
  version" (AGENTS.md).

## Month lock and header (19 Oct 2026)

- Month lock as in NUH junior monthly: a month is locked when `months[m].status` is `published` (shared through the
  month document). `store.commit` refuses any change to a locked month's days (`onLocked` shows why); the padlock beside
  Today toggles it, and the roster shows a slim "is locked, Unlock to edit" line. Every month with days in it locks when
  the app opens and when it closes (`lockAll`, `ensureLocked`); an empty month is left open so a new roster can start.
  Excel import and Rotations from People pass `{ unlock: true }`: they unlock the months they fill, in the same undo
  step. Never in practice.
- Header: one line on phones (name, cloud, undo, redo, help; then month, Today, padlock, Fill). The main button reads
  "Fill" with no icon; it hides in a locked month.

## Request priority (19 Oct 2026, `js/reqprio.js`, `js/ui-reqprio.js`)

- Call requests (Cr) and no-call requests (Nc) are counted together per person per month. The first
  `settings.requestCap` (default 2) by date count in full; later ones are "if possible": a broken one under a hard
  rule (Nc) is soft at 60 x cap / count, under a soft rule (Cr) its weight x cap / count, so whoever asked for more
  gives way first. Marks in the cell (`cell.rp = { Cr: '!' }`): `!` counts in full (hard stays hard, soft x3), `?` is
  if possible (x1/2 within the cap) and frees a place for the next one. Weekend requests (Wr, Nw) and Pr/NP unchanged.
- Shown as `Cr!` / `Nc?` in the grid, Day view and Excel export; the import reads them. The cell editor has Must /
  Auto / If possible per Cr or Nc; Check > Request priority lists every one by person (most requests first), with
  the limit and bulk marking.

## Junior pool (19 Oct 2026)

The junior roster is run by a different person from the senior one, from the same department sheet. One state, two pools.

- **Pool switch** (Junior | Senior | All, beside the month; `settings.pool`) narrows the grid, Day, Check and More lists, and
  scopes the rule check and Auto-fill to that pool (`scopeToPool` in `js/jpool.js`: the other pool's people are left out and a
  rule only about them is off, so a consultant call rule is not reported while viewing juniors). A person's pool is the tag
  `jpool` / `spool`, else their section's kind (`M.poolOf`). **People > Junior pool** sets where the pool starts (this person
  and everyone below), each person's call level (MO2 = the senior MO on call, MO1 = the junior MO on call, No calls) and
  strong / weak. Levels are tags (`mo2`, `mo2strong`, `mo2weak`, `mo1…`, `nocall`); setting the first one installs the junior rules.
- **Junior rules** (`JUNIOR_RULES`, ids `r-jp-…`, `installJuniorPool`, one time per saved state via `settings.jpRules`): cover (1 MO2 and
  1 MO1 on call, 3 on Saturday, a half call HC on Sundays and public holidays, a PM shift on weekdays), no calls for No calls
  people (one half call a month at most, last resort), rest after calls and PM shifts, JR teaching day, at most 3 on AL (pointed
  out, leave is never moved), pain service week (no calls, then the Monday PM shift), weak MO2 never with weak MO1 (strong with
  strong is a preference), and a set marked **To confirm** (gap, weekend limit, no call before an APS week, fair spread, Nc means no
  PM or half call). Rules whose note starts "Predicted" show a To confirm badge; Confirm / Confirm all drops it (ported from
  the NUH junior monthly screen, with the priority-ordered Preferences list and the how-it-works panel). No new rule type was needed.
- **Sheet colours** (`io.js` `fillKind`): blue (99CCFF) = approved, so the cell gets `ap: true`; white leave is a request. Green
  (33CC33, or 92D050 in older sheets) with no text = a pain service (APS) week. A blue cell with text that is not a code (a course
  with a time) becomes a leave code, the course word first. Section headings with lowercase (the PACU / pain nurses) map to the `nurse` group.
- **Fill the sheet back** (`fillDeptWorkbook`, More > Export): writes C, P, HC and green APS weeks into the file the department
  sent and nothing else (a request the shift satisfies, like Cr beside a C, stays as written). The file is kept in memory from the
  import (or chosen again). ExcelJS shares style objects between cells: set `cell.style = { ...cell.style, fill }`, never `cell.fill =`.
- **APS weeks** (`js/aps.js`, Check > APS weeks): a week is Monday to Sunday, stored as APS on 7 days. Suggestions rank by weeks done (typed
  count `state.aps` + weeks in the cells after it), JRs first when manpower is good, never R3, never two months running, one per
  person a month; the person confirms. "Read old rosters" counts green weeks from past sheets.
- **Leave dates** (Check > Leave dates): unapproved AL / AAL that puts more than 3 of the call list away; up to 3 nearby windows of the
  same length and weekend mix, with a Move button. **Add a request** (Rules, or Request… on a person): a one-off request becomes a
  `limit` rule for its dates only, named "Request: …".
- Limits: a public holiday on a Monday (a holiday in lieu) must be added in settings or the Monday PM rule after an APS week
  expects a shift; fair spread is per month, not scaled by free days; the weekend limit counts Saturdays and Sundays, not holidays on weekdays.
- Tests: `test/jpool.test.mjs` (tags, install, scoping, auto-fill on a made-up pool, APS, leave, sheet colours and fill back),
  `test/pool.e2e.mjs` (switch, setup, To confirm, request form, APS, phone width).

## Decisions

- 2026-10-15: own app in anawj-site at `ntfroster.anawj.com`, not on anantf.com (that site keeps rotas off it) and
  not shared with the NUH roster (different department, logic and data).
- 2026-10-15: one monthly grid like the department sheet; assignments and requests kept apart in each cell; post
  call derived, never stored.
- 2026-10-15: every rule is data the owner edits in the app; ten generic types with who/when filters, hard or soft
  with a weight; a new type is one `RULE_TYPES` entry plus a test.
- 2026-10-15: local first with JSON backup; Firebase team sync built but off until the owner creates the project.
- 2026-10-15: built by five parallel builders against `SPEC.md`, then integrated and tested in one pass.

Phone details (review, 15 Oct 2026): paint mode paints by tap on touch screens (a swipe scrolls) and has a "Done
painting" button; Back closes an open sheet, and the rule builder asks before discarding changes; removing a person or
deleting a rule asks first; the roster toolbar has a Key for the grid's marks; Add a rule starts with "Combination
restriction" (same day, following days, between two people, and ready-made ones).

## Known limits

- The cell editor lists every code (long, but it scrolls).
- The grid is one big table (about 2,000 cells for 65 people): on a slow phone a full redraw still takes about a
  second of work in total, though the rows on screen show first (Speed, above).
- `spread` is always soft; `sameDay` forbid needs two different code lists (`@shift` + `@shift` means two shifts).
- The solver may meet a `standing` rule by putting the person on call the day before (post call counts as away).
- On phones the fairness table scrolls sideways with the name column fixed (cards for 60 people were too long).
- Not done yet from the 15 Oct review (features): a "who's free" picker to fill a gap, ghost chips for the Auto-fill
  preview and per-group spread, a compact phone rules list, drag to reorder and multi-group bulk add in People, a day
  stepper in the phone cell editor, folding past public holidays in Settings.
- The rules log records who changed a rule only when signed in to team sharing.
- The 2027 dates for Hari Raya Puasa, Hari Raya Haji, Vesak and Deepavali in `demo.js` are from memory: check them
  against the Ministry of Manpower list before relying on them ("Load Singapore public holidays" uses them).
- The cloud's merge by pool is tested in unit tests and the emulator only, not yet with two people saving live.

## Senior residents and moving someone by hand (19 Oct 2026)

- Senior residents (`sr`) are a senior section: they are rostered with the seniors. Older saves move the section once
  (`settings.srv`) and drop old pool tags from its people; a section set back to junior by hand stays.
- Anyone can be moved to the junior or senior roster by hand: person details › Roster (`p.pool`: `junior` | `senior`,
  absent = automatic). `M.poolOf` checks it first, then the `jpool` / `spool` tags, then the section. The move is kept
  on reimport (matched people keep their fields) and by "The junior pool starts at", which also never puts a senior
  section in the junior pool. Junior pool setup lists who was moved by hand.
- The Excel export's Seniors / Juniors count rows follow the same split. Default rules still name `sr` where they did
  (e.g. the 2 juniors on call); rule texts say "consultants" for the consultant sections.

## Sign-in on this host (19 Oct 2026)

- `authDomain` is `ntfroster.anawj.com`: the Worker serves Firebase's helper pages at `/__/auth/` (the shared copies)
  and `/__/firebase/init.json` from `ntf-auth/firebase/` (as apmes does; logbook/README.md, sign-in). The Google
  sign-in client needs `https://ntfroster.anawj.com/__/auth/handler` in its Authorised redirect URIs.
- The installed app and Firefox on Android sign in by redirect (a popup there loses its opener); elsewhere the popup,
  with redirect when a popup is blocked. `watchUser` finishes a redirect with `getRedirectResult`.
- The old address `anawj.com/ntf-roster/` (GitHub Pages; not an authorised sign-in domain) forwards to
  ntfroster.anawj.com. A browser with a roster saved there stays and shows a "Moved" bar: Download backup, then Go
  (Restore from a backup at the new address).

## Rules as plain sentences (20 Oct 2026, `js/rules-text.js`)

The owner: rules must be easy for a person to read and change. Every rule can be written as one exact sentence and
read back as the very same rule (`test/rules-text.test.mjs` checks every default rule and every option of every type).

- **Line format** (Rules › Edit as text, for the roster in view):
  `MUST  Name = Juniors: at most 7 C a month, scaled by FTE (weekends)  // note  [r-maxcall]`. Status first: `MUST`,
  `PREF 20` (a preference with priority 20), `OFF` in front for a rule turned off. `Name =` and `// note` are optional;
  who goes before the colon (left out for everyone; names of groups, tags, people, or `juniors`/`seniors`; `except`
  names people left out; a name that is two things is written `group …`/`tag …`/`person …`); when goes in brackets at
  the end (`weekends`, `Mon, Wed`, `weekdays, except public holidays`, `public holidays only`, `from 2026-11-01`,
  `until …`). Codes are the roster's own codes or the words for tokens (`any shift`, `leave`, `away`, `at work`,
  `post call`, `other duty`, `a request`, `anything`). Each type's sentence is a pattern in `TEXT_FORMS`.
- **Editing**: the `[id]` ties a line to its rule; a line without one (or a copy of a line) is a new rule; a removed
  line deletes its rule. Settings a sentence doesn't show (the run length of a weekly limit, the number on a "never
  with" rule) stay as they were. Review is the import review plus Delete rows, and saving is one undo step. A line
  that can't be read is named ("Line 12: …") and stops the review: nothing is guessed, and its rule is never deleted.
  A rule that can't be written exactly (no codes yet, an unknown person) is a `# Kept as it is … [id]` line.
- **Readable file** (Rules › Export as text): one block per rule, `- name:` then `strength`, `on`, `roster`, `who`,
  `rule`, `when`, `note` (more lines indented four spaces), `id`; a rule that can't be written gets a `json:` field.
  Paste / import reads this file, rule lines, or JSON (`looksLikeRulesFile`, then lines starting with MUST/PREF).
- **Rule builder** (`sentenceEditor` in `ui-rules.js`): the rule at the top as the same sentence with blanks. Who, codes
  and when open their picker below the sentence; numbers, choices (exactly / at least / at most / between, per week…)
  and switches (scaled by FTE) are edited in place. Every field is under "Advanced: every field" (open when a template
  asks to pick people); each side redraws the other. Drawn from `TEXT_FORMS`, so a new type gets its sentence there.
- JSON copy, export and the Guide for Claude are unchanged.

## Rules: all confirmed, Priorities sheet (19 Oct 2026)

- The owner confirmed every rule: no "To confirm" tag or Confirm buttons any more. Older saves drop the old
  "Predicted from the drafted rules" sentence from rule notes once (`settings.rcv`); the junior rules no longer carry it.
- Rules › Priorities (`ui-ruleprio.js`): every rule as a bar (preferences by priority, then must hold, off greyed).
  Drag a bar to change one; tick several to set a priority, raise or lower by 10, make must hold or preference, or turn
  on or off together (`bulkSet`; share-fairly rules stay preferences).
- Rules can be dragged by their grip (⠿; arrow keys on a focused grip) to reorder them, or between Preferences and
  Must hold (`placeRule`). A dropped preference keeps its priority if it already fits between its new neighbours,
  otherwise gets the midpoint; ties are ordered by the rules list, so the rule also moves there (the Rules tab sorts
  the same way). Drag listens on the window: moving the row in the page drops pointer capture.

## Each roster has its own rules (19 Oct 2026)

- The owner: the junior and senior rosters are different institutions, so their rules are separate. Every rule has
  `pool` ('junior' or 'senior') and only ever covers that roster's people.
- Older saves and imported rule files are placed once on load (`M.splitRules`, run by `migrate` for any rule without
  a roster): the known defaults by id, others by who they name (groups by kind, junior-pool tags, people by their
  roster). A rule about everyone, or both, becomes two: the junior copy keeps the id, the senior copy gets `<id>-s`.
- Engine: `scopeToPool` leaves the other roster's rules out of a Junior or Senior check or fill; in All each rule gets
  `who.only` (its roster's people, honoured by `compileWho`; never saved). The "other people" side of a Between-two-people
  rule is not narrowed (the Baby MO rule may name seniors).
- Rules tab and Priorities show the roster picked at the top (All shows both, each with a Junior/Senior roster tag);
  bulk changes only reach the rules shown. The rule editor has a Roster field; requests take the person's roster.
- Cloud merge by pool now keeps my roster's rules and takes theirs for the other, by `pool`.
- The demo no longer puts senior residents on the junior call (they are on the senior roster since 19 Oct).

## One roster at a time (19 Oct 2026)

- The owner: two rosterers share the app and don't edit each other's work. The header switch is Junior | Senior only
  (no All; `settings.pool`, per browser, defaults to junior). It applies to the whole app: grid, People, Rules,
  Priorities, checks and Fill show only the roster in view. Both rosters stay editable; the switch picks which.
- Month lock is per roster: `months[m].locks = { junior, senior }` (each '' or a time). `status` is `published` only
  when both are locked (older saves: published = both locked; `M.monthMeta`). The padlock and `store.commit` act on
  the roster in view (`lockedHit` checks only that roster's people); `lockAll`/`ensureLocked` lock both. Firestore
  allows `locks` on month and version docs (`validLocks`); cloud merge by pool keeps my roster's lock, takes theirs.
- The grid's "Senior roster" / "Junior roster" toolbar button shows the other roster below, greyed and read-only
  (`tr.ro`, `.cell-ro`, no editor); kept in the UI settings (`ui.other`).
- New people start in a group of the roster in view.
- Limit: a junior-roster check can't see who is on the senior roster, so "Baby MO needs an SRP/RP on call" only counts
  junior-roster people.
