# NUH Junior Monthly: screens and display

Part of [NOTES.md](../NOTES.md). Header, tabs, marks, colours and what each month shows.

## Phone header has no gap (16 Oct 2026)

On phones the second header row is the month, Today, the lock and Fill. Fill shows on the Roster tab only, so on the other tabs
that slot was an empty hole. The month title now takes the free width (`.month-title { flex: 1 }`), so Today and the lock sit at the
right edge on every tab; a phone test checks it on the Day tab.

Fill is also hidden while the month is locked (16 Oct 2026), in the header and in the empty-month banner: a locked month can't be changed, so Fill would only
confuse. It returns when the month is unlocked.

## Cell marks (16 Oct 2026)

The orange corner means a **note**, as in Google Sheets (it used to mark problems, which people read as comments). A problem is a
**ring inside the cell**: must fix is a solid red ring with a soft inner glow, to improve is a thin dashed amber ring. They differ in
shape as well as colour (colour-blind readers), nothing animates, the glow stays inside the cell so it never bleeds into a
neighbour, and in forced-colours (high contrast) mode they become plain solid and dashed borders. The dot after a name (a problem
about the whole month) is unchanged.

## Header, tabs and Check (16 Oct 2026)

- **Tabs:** Roster, Check, Day, a separator, then Postings, People, Rules, More (phones: Roster, Check, Day, Rules, More).
  The header has no Help button any more (Help and shortcuts are under More › Help, and `?` opens the shortcuts); the Lock
  button is a padlock icon; Auto-fill reads "Fill" (its name read out is still "Auto-fill"). From tablet width up the header
  stays on one row: the app name shrinks first.
- **Check shows what Fill places.** "Things to improve" lists only preferences that bear on the codes Fill places (C3, R1B): a
  cell it names holds one of them, or its rule is about them. Must-fix problems always show. A switch ("Only C3, R1B"), on by
  default, brings the rest back (`ui-check.js` `relevanceOf`). A list of every call reads "any call" in messages.
- **Sideways scrolling with a mouse:** week buttons in the roster toolbar, the wheel over the dates, dragging the dates, and
  a visible scrollbar.
- **Equal calls matter more:** the cardiac and ICU fairness rules are weight 40 (were 10; an older saved roster still at 10 is
  raised once, `rulesVersion` 7).

## Posting filter (16 Oct 2026)

The roster toolbar has a posting dropdown (all postings; "C3 postings" and "R1B postings", the postings the fairness rules
count people on; or one posting), and the C3 and R1B column headers at the top right of the grid are buttons that do the same
(press again for everyone). It shows people with that posting on any day of the month (`ui-roster.js` `postingSet`).

## Phone header, filters and banners (16 Oct 2026)

On phones (320 to 720 px) the header is two rows: the name (it gives way, with an ellipsis) beside the cloud, undo and redo
buttons, then month back / Oct 2026 / forward / Today, the lock and Fill. Every header control is 44 px high with one radius and one
icon size; below 360 px Today and Fill become icons and the cloud button loses its word (their names are still read out). The
roster's filter row is Paint, Find and one **Filters** button (with a count) that opens a sheet holding the group, tag, posting and
highlight selects and the Requests, Days around and Key buttons (the same elements move between the row and the sheet when the
window crosses 720 px). The locked-month and empty-month banners are one slim line each (40 px); the full wording is on
desktop and in their description. `test/e2e.mjs` checks 320, 360, 390 and 430 px: nothing clipped or overlapping, 44 px,
slim banners, axe on the header and the Filters sheet.

## Colours follow the department sheet (16 Oct 2026)

People work on the sheet and this app side by side, so a code keeps the sheet's colour family (softened, same hue): calls orange
(C3, R1B, R1 to R3, S1, S1B, OGC), OGN and OGD red, cardiac C magenta, ICU yellow, chronic pain green, acute pain bright green,
liver transplant purple, leave blue, premed and Saturday ward round peach, post call, PPC, Z and NTF grey, blocked, no-call and
no-premed requests red (outlined and tinted), call requests blue, KKH, TTSH, OG1/2 and AH plain. `PALETTE` in `js/model.js`; the
colours before the change are in `BASE_DUTIES`, and a saved duty still in its old colours moves across once (`rulesVersion` 10);
a colour the rosterer chose is kept (until `rulesVersion` 14, which sets every palette colour once; later changes stay). Readable first (owner, 16 Oct 2026: stronger fills made the text hard to read, so the original look came back in the sheet's hues): calls a deep orange with white text, obstetric calls deep red, postings and leave soft tints with bold dark text, requests outlined chips (no fill). Text must still pass axe contrast (the e2e checks), so some are a shade darker than the sheet.
The sheet's cyan "leave requested, not yet approved" is not in the app yet. The screenshots the palette came from are in the owner's private notes.

## People not in the imported sheet, and folding groups (16 Oct 2026)

An import records who the sheet lists (`sheets[month].inSheet`) and who was on the staff list at that moment (`known`).
Anyone known but not listed is **hidden from that month and treated as not in post** (`model.js` `notInSheet`: the roster,
Day, Check, exports and, through `act` in `rules.js`, Auto-fill and the rules). Someone added after the import is not in
`known`, so they stay visible. The roster toolbar says "N not in the sheet" and shows them again (setting
`hideNotInSheet`, default on). Months with no imported sheet hide nobody. `sheets` is not part of the cloud copy, so a device
that has not imported the month shows everyone. Group headers in the roster fold (`ui.collapsed`, kept per device).

## Grades come from the sheet, per month (16 Oct 2026)

Each import records the grade (group) every person has in that month's sheet (`sheets[month].grades`). A month shows, and
the rules and Auto-fill use, the grade its own sheet gave (`model.js` `gradeIn`, `personIn`, used by `staffInMonth` and the
rule context), so a promotion changes only the months from then on and an old month keeps the grade it had. People
and a month with no sheet use the current grade (`staff[].group`), which still moves only when the newest month is imported
(the review's ticks); an unticked move stays in People but the month still shows what its sheet said. Someone listed twice
takes the grade of the row that is kept. Not done: a dated change in the middle of a month, and showing "from February" in
People for a future month's sheet.

## A call on the posting's own day (16 Oct 2026)

On the sheet a C3 replaces the C that day, so the cell holds no posting code. For the rules (`buildContext` in `js/rules.js`) a C3
(or R1B) day with no posting of its own counts as on that posting when the person has the posting (C, ICU) within three days either
side, in the saved cells too, past the edge of the month. Nothing is written to the roster. So "cardiac call only on a cardiac day"
no longer flags the call itself; a C3 nowhere near a cardiac day still does. The cardiac posting filter and the fair share also count
C3 days (R1B for ICU). The soft preference "no cardiac call on day 1 of the posting" (`r-c3-d1`) does not apply to RES3 and senior
residents (a group limit on the rule; saved rosters get it once).

