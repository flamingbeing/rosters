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

## Roles and the rules kit (25 Oct 2026)

- Rules: edit `firestore.app.rules`, then build the committed `firestore.rules` with app-devkit's
  `tools/build-rules.mjs` (it pastes in the kit's `rules/common.rules`; the kit is pinned at `v1.4.0` in the Checks
  `rules` job, which fails on a stale build).
- Roles: the token's claim `g._` when there is one, else `members/{email}.role` (older pages, or while the Worker has no
  service account). Reads cost 1 lookup on claims (`revoked/{uid}`), 2 on the members entry. Changes to the members
  list always check the admin's entry, never the claim.
- Worker (`worker/ntf.js` on `worker/members.js`, this host only): `POST /api/claims` puts the role on the account
  (the page calls it after sign-in and when its entry's `v` is ahead, then refreshes its token); `POST /api/members/sync`
  (admins, after a change) writes `revoked/{uid}` for a removed or lowered member, so their older claim is refused at
  once. Without the secrets `NTF_SA_EMAIL` and `NTF_SA_KEY` both answer 503 and everything runs on the members entry.
- `members/{email}.v`: 1 when added, one more on each role change (rules-checked; older entries without one count as 0).
- Tests: `node ntf-roster/test/claims.test.mjs`; `bash tools/test-rules.sh` (`test/rules.emulator.mjs`, the kit's
  shared suite `test/rules.kit.emulator.mjs`, the Worker end to end in `worker/test/ntf.emulator.mjs`).

## More detail (all public, code facts only)

| File | Sections |
|---|---|
| [docs/rules.md](docs/rules.md) | Rules engine (`lib/roster-core/rules.js`, wrapped by `js/rules.js`); How to add a new rule type (step by step); Sharing rules as text (`js/rules-share.js`); Rules as plain sentences (`js/rules-text.js`); Rules: all confirmed, Priorities sheet; Each roster has its own rules |
| [docs/fill.md](docs/fill.md) | Auto-fill (`js/solver.js`, `js/solver-worker.js`); Request priority (`js/reqprio.js`, `js/ui-reqprio.js`); Junior pool; Senior residents and moving someone by hand |
| [docs/data.md](docs/data.md) | Excel (`js/io.js`); Rotations from APMES People (`js/rotations.js`, `js/people-pull.js`); Storage, practice and team sharing; Month lock and header; Sign-in on this host; One roster at a time |
| [docs/speed.md](docs/speed.md), [docs/walkthrough.md](docs/walkthrough.md) | Speed; first-time help |
| [SPEC.md](SPEC.md) | The module contract (state shape, exports, rule types) |

## Roster core: auto-fill, rules and model

The engine is shared with nuh-junior-monthly in `lib/roster-core/` (`/lib/` on every host); this app's files are thin wrappers:
- `js/solver.js` gives `createSolver(deps, cfg)` this app's model and rules (`fillOption: 'codes'`, `keepOtherAuto`, `reach: 1`, no
  up-front blocks).
- `js/rules.js` gives `createRules(deps, cfg)` this app's options: request priorities (`reqprio.js`) and "consultants" in the words.
- `js/model.js` keeps this app's data, migrations, month locks per roster and the pools; dates, lookups and the cell helpers are the
  core's (`createCells({ requestMarks: true })`: approved leave and request marks kept in a cell), re-exported.
`sw.js` SHELL lists the three core files. `test/solver-pins.test.mjs` and `test/core-pins.test.mjs` pin auto-fill, the rule list, its
words, checks and the cell helpers, recorded from the app's own files before each move (re-record with `--write` only when a change to
the results is meant). Fix the engine once, in `lib/roster-core/`.

## Unsent saves (25 Oct 2026, app-sync 0.6.3 `createApp`)

The same as NUH junior monthly (its NOTES.md "Unsent saves"); what differs here is marked. Here sign-in too is
createApp's (`cloud.signIn` → `app.signIn`: popup, or redirect in the installed app and when a popup is blocked; this host is
the auth domain); with core.anawj.com unreachable it is the plain popup.
- Save to cloud goes through `js/unsent.js` > `lib/roster-core/docsync.js` (one copy for the roster apps): app-sync's
  `createApp` with the app's own write as its `commit`, exact pin `core.anawj.com/sync/0.6.3/`, every module precached in `sw.js`. The write is still `cloud.saveAll` (staff list, rules
  and changed months in one transaction, with its per-document "someone saved first" check and sheet prompt). Offline or
  cut off: the save is kept on the device ("Kept on this device"), the Team sharing panel shows how many wait (Retry;
  Set aside when one failed), and it is sent when the connection returns; this browser then counts it as saved.
- A save whose answer was lost is recognised (the cloud already holds the same staff list, days, status and, here,
  each pool's lock), so it is not saved twice.
- The conflict sheet: Save mine anyway saves over theirs; Merge (here: keep my pool), Pull theirs, Cancel or closing it
  sets the held save aside (Merge then saves the merged roster anew).
- Sign-out refuses while any save is unsent, then `forgetDevice` forgets the outbox (also runs its clean-up when the
  outbox could not load). The roster in this browser stays, as before.
- Back-to-back offline saves carry the same seen copy; `docsync.js` sends each later one against the time the previous one
  wrote, so it does not conflict with this device's own save.
- Update module 0.2.0 with `canReload`: a new version waits while someone is typing, a dialog or sheet is open, or a save
  waits to be sent; it is tried again on leaving a field and when the unsent count changes.
- Every Firebase call goes through `js/cloud.js`, and only `js/unsent.js` calls its saves; `test/adapter.test.mjs` fails
  if another module loads the SDK, reads `firebase-config.js` or saves around the outbox. Admin actions (roles, access
  requests) stay direct and online-only, as before.
- Tests: `test/docsync.test.mjs`, `test/unsent.test.mjs`, `test/precache.test.mjs`, `test/adapter.test.mjs`.
