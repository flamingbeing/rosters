# NTF Roster

Plans the NTF (Ng Teng Fong) anaesthesia department's monthly duty roster: calls, PM shifts and clinics together with
leave and requests on one grid, checked against rules the owner edits in the app, with Auto-fill. Address:
<https://ntfroster.anawj.com/>; practice with a made-up department at <https://ntfroster.anawj.com/?demo>.

Background, department codes, the data model, the rules engine (and how to add a rule type) and the decisions are in
[NOTES.md](NOTES.md). The module contract is [SPEC.md](SPEC.md); what is happening now is in [STATUS.md](STATUS.md).

## Flow

1. **People** (on phones: More › People): import the department's "ALL STAFF LEAVE REQUEST" sheet (More › Import),
   or add staff by hand or by pasting a list. Groups, tags and duty codes are there too.
2. **Roster**: enter leave and requests (tap a cell, or Paint to drag a code across days), then **Auto-fill** the
   calls and PM shifts. Preview, then Apply (one undo step). Locked cells and anything typed by hand are kept.
3. **Rules**: add or change a rule at any time (Add rule › a template or a rule type); the builder shows the sentence
   and this month's problems as you edit. **Check** lists the problems by rule, fairness and coverage.
4. **More**: export Excel in the department layout, PDF, CSV or one person's calendar; backup and restore; public
   holidays; team sharing.

## Run it locally

From the repo root: `python3 -m http.server 8080`, then open <http://localhost:8080/ntf-roster/?demo>. Add `?nosw`
to skip the service worker while developing.

## Tests

From the repo root:

```
for f in ntf-roster/test/*.test.mjs; do node "$f"; done   # rules engine, solver, Excel parser (no browser)
node ntf-roster/test/e2e.mjs                              # browser test: needs the server above on port 8080
node ntf-roster/test/perf.e2e.mjs                         # speed budgets on a slowed phone (by hand, not in CI)
tools/test-rules.sh                                       # firestore.rules in the local emulator (all apps)
node tools/check.mjs                                      # repo check (sw.js SHELL lists files that exist)
```

- `test/rules.test.mjs`: every rule type, tokens, descriptions, validation and speed (~290 checks).
- `test/solver.test.mjs`: Auto-fill on a made-up 70-person department (~2,500 checks, ~12 s).
- `test/io.test.mjs`: Excel import and export on a generated sheet with invented names (~200 checks).
- `test/e2e.mjs`: Practice in Chromium at 1300×900 and 390×844 plus a fresh start: every tab with axe (WCAG 2 A/AA),
  cell editor, paint and undo/redo, a new rule appearing in the grid and Check, Auto-fill next month to zero must-fix
  problems, Excel export then import, backup and restore, the app version lines (~85 checks, ~45 s). `SHOTS=<dir>`
  saves screenshots.
- `test/perf.e2e.mjs`: tap a cell → editor, tap a code → grid, switch month, timed at 390×844 with the CPU 4x slower,
  against budgets (~1 min). Timings vary by machine, so it is not in the Checks workflow.
- `test/rules.emulator.mjs`: the Firestore rules (run by `tools/test-rules.sh`).

## Code

| File | What |
|---|---|
| `index.html`, `style.css`, `js/app.js`, `js/store.js` | shell, header, tabs, router, toasts, sheets, store with undo |
| `js/model.js` | state shape, default groups/tags/codes/rules, dates, cell helpers |
| `js/rules.js` | rule types, describe, validate, evaluate |
| `js/solver.js`, `js/solver-worker.js` | Auto-fill and its Web Worker |
| `js/ui-roster.js`, `js/ui-day.js` | the grid, cell editor, paint, person view, Auto-fill dialog; the day view |
| `js/ui-rules.js`, `js/ui-people.js`, `js/ui-check.js`, `css/rules.css` | Rules, People and Check screens |
| `js/io.js`, `js/ui-more.js`, `js/demo.js` | Excel/JSON/ICS/CSV, the More screen, the practice department |
| `js/cloud.js`, `js/ui-team.js`, `js/firebase-config.js`, `firestore.rules` | team sharing (off until configured) |
| `sw.js`, `manifest.webmanifest`, `icons/`, `js/version.js` | installable offline app, app version lines |

Vendored: ExcelJS 4.4.0 (MIT, `vendor/`).

## Team sharing (optional)

Off until the owner creates the Firebase project `ntf-roster`. Steps are at the top of `js/firebase-config.js`: create
the project with Google sign-in and Firestore, add `ntfroster.anawj.com` to the authorised domains (never preview
domains), paste the web config, add yourself as the first admin in `members/{email}`, grant the rules-deployer
service account Firebase Rules Admin, and add the project to
`.github/workflows/deploy-firestore-rules.yml`. Staff names and leave are then stored in Google Cloud: check PDPA and
hospital policy before using real names.
