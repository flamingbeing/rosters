# NUH Roster: known limits and recent changes

Part of [NOTES.md](../NOTES.md).

- Text typed into the person box can't use "/" (it separates names in a cell) or brackets (they hold tags). "w/" becomes "with", "/" becomes "or" and brackets become [ ].
- A comment that is only a time ("5pm") reads back as a leaving time, as in the older roster style "Name -5pm".
- AOH and liver duties don't make anyone post call; only the duties listed in Settings do.
- Undo is per date and is cleared when the header date changes.
- Practice › Fix 3 problems plants random problems; on a day already short of a senior it plants a second double cover
  instead of a "no senior" room. Fill empty gaps tries a few seeds and keeps the fullest, but now and then (about 1 in
  10 tries) it still gives a freed senior another job and a planted gap needs fixing by hand. The browser test tries
  the exercise up to three times.
- When this browser can't save (storage full), a bar says so and offers Download everything and Remove old days
  (more than 3 months old); saved data that can't be read is kept under `<key>-damaged-<time>` with a download.
  Days put away don't keep their checks (rebuilt on opening).
- Save for the team writes team/main, team/monthly and team/rotations in one transaction (`saveTeamAll`) with the same
  conflict check as rosters (`expectedUpdatedAt` = `state.teamSyncedAt`): if someone saved after this browser loaded,
  it asks before replacing theirs. On sign-in, a newer team list doesn't offer to replace a browser with unsaved team
  changes; a toast offers "Load theirs". Team documents still keep no version history (rosters do).
- Two tabs: when another tab saves the roster (`storage` event), this tab stops saving and shows a bar with Reload.
- Not signed in to the team: once a week a bar suggests Download everything (`state.backupAt`; "Later" waits a week,
  per device in `nuh-roster-backup-nag`; quiet for the first week).
- "Sign out and clear this computer" (for shared OT PCs) removes every `ot-roster*` / `nuh-roster*` key, then reloads.
- Live checks (13 Oct) also catch: a double-covered room with no junior (error, Fill), a senior in 3+ rooms (error),
  someone senior in one room and junior in another, and an admin-day or elsewhere person on a list (warnings). The
  Baby MO, premed cap and complex-list problems now have fix or Show buttons.
- Monthly rosters: an Excel file is read from the first sheet that looks like a roster; an import says which expected
  columns weren't found (a renamed heading) and goes on the Undo list, as does Clear (no "are you sure?"). A name that
  matches several people says who it could be in its tooltip.
- Accessibility (13 Oct): every tab passes axe (WCAG A/AA) in Practice. Roster names and person chips are focusable
  (Enter or Space opens the box); the box takes focus, keeps Tab inside and gives focus back on close; problems start
  with "Problem:", "Check:" or "Note:"; table fields get an aria-label from their column and row (`labelTableFields`).
  On screen the Baby MO green is darker (`SCREEN_COLOUR`); the sheet and exports keep the department's colours.
- Monthly planning (13 Oct): the grids mark clashes before the day comes (`monthIssues` in `js/monthly.js`): on
  leave but given a duty, a day duty the morning after an overnight one, two overnight duties the same day (red), and
  an empty overnight duty on a day with others filled in (dashed). Liver and AOH rosters are on call, so they don't
  clash with being post call. Each bar has "Next ›" and shows which rosters are loaded for this month and the next.
  The Leave view has a strip of seniors/juniors away per day (Settings: mark days over a limit; 0 is off). The made-up
  rosters are tidied of clashes (`tidyMonthly` in `js/demo.js`; DEMO_VERSION 6).
- Generator seniority (13 Oct): complex lists (−3/+3), double covers (−2/+2) and rooms with a Baby MO or MOPEX (+4
  otherwise) prefer SC and C (`STRONG`); subspecs and the hard rules still win (subspec matches unchanged over 80 demo
  runs). The spare senior who takes half a double cover is the best fit, not the first. Each generated row carries
  `why` ({ personId: reason }), shown as "Why here:" when hovering a name. AOCC leaves the last free consultant for AIC
  (it took them 12 times in 20 before).
- Faster mornings (13 Oct): the person box has "Same until": the status and comment go on each day up to that date
  (`state.carry`, applied when a day is opened, `applyCarry`; a hand change on that day or a monthly leave/MC/post
  call wins). Cases has "Start from last <weekday>" (running rooms, sessions, fixed people from 7 days before, if this
  browser has that day; not case notes). With no roster yet, Roster offers "Start from <day>'s roster" (the last day
  within a week this browser has one for): rows for today's running rooms in today's order, today's case notes, then
  the live checks flag who is away now. Members get "Save for the team, then image" in the Download menu.
- Practice (13 Oct): the bar has "Fix 3 problems" (makes the roster and plants someone on leave on a list, a room
  with no senior and a double cover with no junior; a checklist card on Roster ticks each off from the live checks)
  and "Reset this day" (with Undo). Cases has "Download a practice draft" (the admin team's format, cases in column L)
  so "Do it all" can be practised. "Try a morning…" (Practice bar) sets up Short-staffed (seniors away until some rooms
  are double covered), Late MC at 7am (a senior and a junior on the roster go MC) or A weekend; the same as links for a
  trainer to send: `?demo=short`, `?demo=latemc`, `?demo=weekend` (once per visit; no tour on those links).
- Download › "Image in 2 parts": the calls and lists, then the OT rooms (each with the title and date), so neither is
  shrunk past reading when WhatsApp compresses a tall photo (`buildRosterCanvas(layout, width, spans)`, `layout.otFrom`).
- The draft's date (C5) is read by `dateFromText` (ISO, day-first d/m/y, "14 Oct 2026"), not `new Date()`, which reads
  these differently in Safari. `test/design.test.mjs` checks the kit is linked (and cached by `sw.js`), the band, and any `/* n-… */` copy in
  style.css still matches `nuhsdesign/tokens.css`; highlight yellows are `--hl-bg` / `--hl-line`.
- Fix names (13 Oct): names an import couldn't match (draft, rotation file, red names on a monthly roster) get a card
  with a picker per name (closest names first, by `sameNameScore`); saving keeps the spelling as that person's short
  name (in the staff log) and reads the draft or rotation file again (`lastDraft`, `lastRotFile`).
- Key and help (footer, and a link under the roster's one-line hint; texts in `js/help.js`): what each mark means (`SYMBOLS`: &, (C), C-,
  L-, (L), postings, (AOH), colours, ☾ and •, AOCC/AIC/AH OT…) and "How do I…?" answers (`HOW`), one open at a time.
  Entries describe only what the roster does; don't add expansions of abbreviations nobody has confirmed. A printable
  one-page guide (`guide.html`: the morning steps, changing things, the marks) is linked from it and from the tour's
  last step; keep it to one A4 page.
- Rotations: under the grid, a count per posting for every week (0 in red), and "Start <next year> from <year>"
  (week n copied to week n, only into empty weeks, with Undo) when the next year is still empty.
- Phones: Cases shows each room as a card (run, room and session, then case notes, flags, fixed people; rooms not
  running show only their first line). Labels made into buttons (`label.btn.primary`, e.g. "Do it all") now look primary.
- Unexpected errors (`error` / `unhandledrejection`) show one plain toast a minute at most ("your last change may not
  have gone in… Undo, or reload"); the toast empties before each message so screen readers repeat it; long single-line
  text in the image shrinks to the sheet's edge.
- Comments go out on the sheet: the person box's Comment says so (no patient details, NRIC, phone numbers or medical
  reasons); keep that rule in any new free-text field that is sent out or saved for the team.
- Phones: a "Next step" bar at the bottom (`#nextbar`, from the same steps as the strip): the first step not done, with
  Go / Show / "Make it" (on Roster with no roster). Hidden on desktop, Staff, Settings, for viewers and in print.
- What's new (`WHATS_NEW` in `js/help.js`): a dated list in plain words, offered once per device after an update (a toast
  with "What's new", waiting for any message already on screen; not on a first visit or in Practice) and always from
  Key and help. Add a line when a change is something rosterers or viewers would notice; start a new date at the top.
- Keep building elements with `h()` and `textContent`; there is no `innerHTML` anywhere, so imported text can't inject.
