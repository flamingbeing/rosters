# NUH Junior Monthly: other areas, fairness and requests

Part of [NOTES.md](../NOTES.md). The leave waitlist, R1 to R3 calls, shared calls, requests, Fill options and rotations.

## Growing beyond cardiac and ICU calls (16 Oct 2026)

The owner wants the app to take over the department's other monthly sheet tabs one at a time, so the move off the sheet is smooth:
the **leave waitlist**, the **WR / premed roster**, the **junior call roster** (EOT calls: emergency theatre calls manned by R1 to R3
and S1) and later more. Each new area is a module of its own (data, a reader for its Google Sheet tab, a screen, rules, and later
a write-back of just its cells), not a special case in the main grid. The terms follow the NUH daily roster app
(`nuh-roster/NOTES.md`); the ICU call is R1B.

Built so far (step 1): `js/waitlist.js` (pure: reads the Leave Waitlist tab's rows of `{ v, bg }` into entries with a status, matches
names to the staff list), `gsheets.js` `readColoured` (text plus fill colour only, read only) and `findTab`, `ui-leave.js` (the
**Leave** tab, `#leave`; on phones a card in More). Stored per month in `state.waitlist[month]` on the device (not in the cloud
copy yet). Nothing is written to the sheet from it.

The leave waitlist's **status is only a cell colour** in the sheet (orange waitlisted from an application, no fill ad hoc, green
expedited approved, blue approved, red bad day or rejected, cyan roster drafted and closed). The app reads the nearest legend colour
and writes the status on every chip (colour is never the only sign).

Decided for the next steps: the **daily rosterers** (who run the NUH daily roster, a different group from the monthly rosterers)
change a waitlist status, letting waitlisted people go when manpower is good, so there will be a separate member **role** for them
(waitlist status only; read everything else), kept in its own cloud collection so the rules can allow just that. Late requests
(within 5 working days of the leave date) get a flag. Real tab contents and names are in the owner's private notes.
Order: (1) the shared structure and the read-only leave tab (done), (2) status changes with write-back and the role,
(3) the WR / premed roster, (4) the junior call roster and EOT calls, (5) their rules and Fill.

The Junior Call Roster tab has one row per day, no header and no formulas: columns A to C are the three EOT calls (R1, R2, R3), E and F the obstetric day and night calls, G the ICU call (R1B) with the person's specialty in brackets. S1 and S1B are not on it. The tab can be rebuilt from the main grid (how the columns were worked out: details in the owner's private notes).

## Screening requests and the strong / weak pools (16 Oct 2026)

The R1 to R3 rosterer (the owner's notes say who) opens the sheet's Request tab to the juniors, who type their requests in the grid (`R` or `R_` call
request, `X` no call, `NP` no premed, `X/NP` both in one cell). The aim is to find the problems found and settled by hand **before**
anything is assigned. Built as ordinary rules, so they show on Check and in the sheet:
- `r-req-load`: at most 4 requests a month (call requests, X, NP). `X/NP` is one request (the rule counts days, not codes).
- `r-req-npload`: at most 2 no-premed requests a month. Premed duties (P1 to P6) are not counted yet: they are not on the sheet
  until the premed roster is planned (step 3 of the expansion).
- `r-pool-1/2/3`: at most one call request a day from the MO1 pool (strong and weak), the MO2 pool, and strong MO2 with weak MO3.
  Off until the pool list is imported. Which of the clashing people gets the call is settled by hand, by the reason for the request.
- `R_` is the same as `R` (`sheet.js` strips the underscore); `R1`, `R2`, `R3` are the assigned calls, a different thing.
- The pools are six tags (`mo1s mo1w mo2s mo2w mo3s mo3w`) next to the call level tags `mo1 mo2 mo3`. **People > Tags > Import the
  strong / weak list** takes the department's manpower master list pasted from the sheet (heading row "Strong MO1", "Weak MO1" ...;
  other columns ignored), matches names with the staff list, and gives each person the call level and the pool tag (`js/pools.js`).
  The real list is in the owner's private notes.
- Built next (rules `r-mo-*`, all off until the Rules tab's "Turn on all the R1 to R3 rules" button is pressed, with the other R1 to R3 rules `r-r1/2/3-cover`, `-who`, `r-gap`, `r-fair`): no R1 to R3 call on a posting, obstetric call or rest day; at most one weak MO among a night's R1, R2 and R3 (so a weak R1 gets a strong R2 and R3, and so on); no Friday call six days after a Saturday call; residents 3 to 5 calls a month, fellows 1 to 2, MOPEX 1.
  The other rules are the existing ones: calls followed by PC, leave and Z, X and X/NP, the Saturday cap of 2, no two Saturdays running, no Friday or Saturday after a Sunday.
- Built after that (rulesVersion 19, also off until the group is turned on): no Saturday R1 to R3 call after an ICU call the previous Thursday, Friday, Sunday or Saturday (`r-mo-icusat1` and `-icusat2`, using the Day-after rule's new "only when that day is a Saturday" setting, `thenDay`); at most 2 Friday, Saturday or Sunday calls a month for people carrying the tag **Fri to Sun call cap** (`r-mo-fss`; the rosterer ticks the tag on the person it applies to, so no name is in the code); and a call request (`R`, and `R!` more strongly) from someone in the MO1, MO2 or MO3 pool is given R1, R2 or R3 (`r-mo-pool-r1..3`, `r-mo-pool-rh1..3`: who is the pool's tags, so they only touch imported people).
- **Fill can draft R1 to R3** (rulesVersion 20): R1, R2 and R3 are auto-fill codes, so the Fill dialog has a tick for each (unticked by default; cardiac and ICU stay the default). Ticking them and pressing Start turns the R1 to R3 rules on (the dialog says so), then Fill places them like any call. `M.fillCodes(state)` is the list (ticks kept on the device) and Check's "only what Fill places" filter reads the same list. Other calls (S1, S1B, OGC...) have no cover rules yet, so they are not Fill ticks.
- **Comparing drafts** (16 Oct 2026): *Try again* and *Try 5 more* in the Fill dialog keep every draft (each a different random start) and list them side by side with must-fix, to improve, the score (the weighted total of all problems, lower is better) and short nights, the best marked; the one picked is applied ("Apply attempt n"). The scores are `after.score` from the solver. **Priority**: a preference's weight is shown as "Priority n" (Check and Rules); Check can order problems by *Biggest impact* (priority x how many, the old order), *Highest priority* or *Most problems*, and the Rules tab's Strength view lists preferences highest priority first. There is no separate "good to have" tier: that is just a low-priority preference (owner agreed, 16 Oct 2026).

## Request importance (16 Oct 2026)

Requests come from the sheet as plain codes, so importance is a code, not a per-cell setting (it would be lost on every
import and export). No-call requests, strongest first: `XX` blocked by the planner (200: it is already decided, so it
outranks everything), **`X!` must have** (going on holiday, 150), `X` asked (60), **`X?` nice to have** (clearing leave, 20). Call requests have the same levels: **`R!`** must have (100), `R` (10), **`R?`** nice to have (3).
All are soft: a night is never left empty for them. Saved rosters gain the codes and rules once (`rulesVersion` 6; a block saved at the old weight 80 becomes 200).

## Shared calls: the rosterer's points, and what counts as cardiac (16 Oct 2026)

- **Points for "share fairly"** (`scheme: 'offdays'`, the default for cardiac, ICU and R1 to R3): a weekday 1, Friday 1.5, Saturday 2,
  Sunday 1.5, a public holiday 1.5 and 2 when the day after is also a day off. In general: 1, plus 0.5 when the day is a day off
  (weekend or public holiday), plus 0.5 when the day after is one (`rules.js` `dayOffWeight`; the two 0.5s are editable on the rule).
  The older fixed weights (weekend x2, holiday x1.5) stay available as `scheme: 'fixed'`. To be confirmed with the rosterer on a
  public holiday that follows a day off.
- **Echo and perfusion weeks (`C-e`, `C-p`) take no calls, so they do not count towards the cardiac share**: the cardiac fairness rule
  counts people on `C` days only (`among: ['C']`), and so does the C3 posting filter (it reads that rule's `among`). A week of
  perfusion plus a couple of `C` days in a month is below the share threshold (15% of the month), so that person is not compared.
  Saved rosters in the old form are updated once (`rulesVersion` 8).

## Choosing what Fill drafts (16 Oct 2026)

The Fill dialog lists the auto-fill calls (C3 and R1B today) with a tick each (the choice is remembered on the device). Only the
ticked calls are drafted (`solve(..., { only: [...] })`, `applyAssignments(..., only)`); every other call, posting, leave and
request stays exactly as it is, but the solver still counts them for all rules (post call, gaps, who is already on call,
cover), so a cardiac-only fill respects the ICU calls already there. Start is off until something is ticked.

## No calls until (16 Oct 2026)

Each person can have a **No calls until** date (People › edit a person; blank = calls allowed; a button sets it a month after
their start date, for a baby MO or a very new person). The hard rule `r-nocalls` (type `noCallsUntil`, on every call) makes a
call before the date a must-fix problem, and Fill never places one (`solver.js` `hardUntil`). Their leave and postings are
planned as usual (leave can be projected as if they pass the test); if one fails, move the date. The staff list in the cloud copy
carries the date (`staff[].noCallsUntil`, `YYYY-MM-DD`); the rule type is in `rules.js`. Saved rosters gain the rule once
(`rulesVersion` 9).

## Carry-over from earlier months (16 Oct 2026)

Fairness is judged over a person's run of postings, not one calendar month, because most stints run across a month end. The "Share fairly" rules for cardiac and ICU therefore add what each person was over (+) or under (-) their share in the months
before: their points minus their posting days times the pool's rate for that month, the last month counting fully and each month
before a quarter less (`carryBalances` in `js/rules.js`; settings "Carry over" 0 to 1, default 0.5, and "Months to look back", default
4). Past months only: next month is not rostered yet, so a symmetric +/- 1 month window was not built. A call day counts as a day on
the posting. Set Carry over to 0 on the rule to switch it off.

## Fewer alerts about equal calls (16 Oct 2026)

The "Share fairly" rules keep aiming for an even share (allowed difference 1 point, so Fill still pushes), but Check and the dot
after a name only mention a gap that is over **Only point it out above** (1 point) **and** over **this % of the average** (40%;
`alert` and `alertPct` on the rule). So a person with few calls, like an MO3, shows up sooner than with a fixed number (1 against an
average of 2 is 50%), and a gap of 2 on an average of 10 does not. Set the percentage to 0 for points only. The R1 to R3 share (off
until confirmed) compares each grade with itself (`byGroup`). Saved rosters get this once (`rulesVersion` 16).

## Rotations from People (built 16 Oct 2026)

APMES People will hold the department's rotations (who is placed where, week by week), read at first from the master
block rotation sheet (plan and decisions: `people/STATUS.md`, Next and decisions log). The owner wants **this app to pull** them, to help plan future months, not People to push them:

- The staff-list hand-off (`js/apmes.js`), reversed: this app opens People with a request, People shows what it would send,
  and sends it by `postMessage` only after the user taps Send, only to this app's own address. No shared database is needed
  for People's first stage (it works in the browser); if People later gets a shared store, this app could read it directly.
- It carries only the postings this app uses: ICU, cardiac (`C`, `C-e`, `C-p`) and the OG floats; people named as this app names
  them (People holds the link from the sheet's name to the person); weeks as Mondays. The layout is the one Postings › Paste
  rotations already reads (names down, Mondays across), so `parseRotations` should take it unchanged.
- Built: Postings › **Pull from APMES People…** (`js/people-pull.js`) opens People in pull mode, answers its hello with the
  staff names, the posting codes this app has and the Mondays shown, and receives the text only when the user taps Send there.
  It lands in the Paste rotations box (`pasteDialog(prefill)`), so the rosterer looks it over and taps Apply: unknown names
  and codes are skipped as with any paste. Details of People's side: `people/NOTES.md`, "Rotations".
- Open questions for when it is built: how provisional weeks (the sheet's `KIV` prefix) and elective weeks (`-E` suffix, mostly
  not counted toward manpower) show on Postings; whether the OG floats (`OGDF`, `OGNF1`, `OGNF2`) are postings or calls here.

