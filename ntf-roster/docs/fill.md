# NTF Roster: Auto-fill, requests and the junior pool

Part of [NOTES.md](../NOTES.md). Auto-fill, request priority, the junior pool and moving senior residents by hand.

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

## Senior residents and moving someone by hand (19 Oct 2026)

- Senior residents (`sr`) are a senior section: they are rostered with the seniors. Older saves move the section once
  (`settings.srv`) and drop old pool tags from its people; a section set back to junior by hand stays.
- Anyone can be moved to the junior or senior roster by hand: person details › Roster (`p.pool`: `junior` | `senior`,
  absent = automatic). `M.poolOf` checks it first, then the `jpool` / `spool` tags, then the section. The move is kept
  on reimport (matched people keep their fields) and by "The junior pool starts at", which also never puts a senior
  section in the junior pool. Junior pool setup lists who was moved by hand.
- The Excel export's Seniors / Juniors count rows follow the same split. Default rules still name `sr` where they did
  (e.g. the 2 juniors on call); rule texts say "consultants" for the consultant sections.
