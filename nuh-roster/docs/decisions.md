# NUH Roster: the app's decisions

Part of [NOTES.md](../NOTES.md).

- **Address:** `https://nuhroster.anawj.com/` (its own subdomain since 13 Oct 2026, so its saved data and sign-in are kept apart from the other apps; see `SUBDOMAINS.md`). The repo folder is still `nuh-roster/`. The old `anawj.com/nuh-roster/` redirects (path, query and `#` kept) from a script at the top of `index.html`; a browser with a roster saved at the old address first gets a bar with "Download everything" (a `kind: 'ot-roster-all'` file that Import JSON at the new address loads), because saved data belongs to its address. Sign-in needs `nuhroster.anawj.com` in the `nuh-roster` project's authorised domains.
- **Static page, no build step:** vanilla ES modules. The vendored libraries load only when needed:
  - ExcelJS 4.4.0
  - pdf.js 3.11.174 (reading HMS PDFs)
  - jsPDF 2.5.1 (the roster PDF)
- **Storage:** everything lives in `localStorage` under `ot-roster-v1`; demo mode uses `ot-roster-demo`.
  - `state.day` and `state.roster` are the current date.
  - Other dates are kept in `state.days[date]`.
  - The header date switches between them, and every tab follows that one date.
  - The monthly rosters are in `state.monthly['YYYY-MM']`.
- **Team sharing:** Firebase Auth (Google) and Firestore, in its own Firebase project `nuh-roster`.
  - `team/main` holds staff, rooms and settings; `team/monthly` holds the monthly rosters; `team/rotations` holds the junior rotations (`weeks: { monday: { staffId: posting } }`).
  - Each `rosters/{date}` doc has an immutable `versions` history, which is what Restore uses.
  - Access is the `members` list plus `accessRequests`, enforced by `firestore.rules`.
  - Member roles: `admin`, `rosterer` and `viewer`. Viewers read everything but write nothing (`editor()` in the rules); the app shows them only My day and the roster saved for the team for the date on screen.
  - The rules (once the 13 Oct rules PR is merged): only `admin` and `rosterer` write (an allowlist, so a missing or
    mistyped role can't); member documents are `{ role, name, staffId? }` with a lower-case email id, and an admin can't
    demote or remove themselves; every roster, version and team write must be stamped with the signed-in email
    (`updatedBy` / `savedBy`); roster ids are dates and match `date`; team documents are only main, monthly, rotations;
    each staff-list save adds a permanent `team/main/versions` copy. Tested in the emulator: `nuh-roster/test/rules.emulator.mjs`
    (run by `tools/test-rules.sh`).
  - The rules deploy automatically on merge to main (`.github/workflows/deploy-firestore-rules.yml`): edit the file, never ask the owner to paste it.
  - The Firebase web config in `js/firebase-config.js` is public by design.
- **Rotations:** a junior's posting on a date is that day's change (`day.staff[id].posting`), else the week's rotation, else their usual posting (`p.posting`). The roster engine and checks get the staff list with each junior's posting for the day on screen (`dayStaff()`), so posting matches and the "(RA)" tags follow the rotation. Rotation edits go through Undo. The Excel layout is names down the first column and each week's Monday across the top; the download is a blank to fill in.
- **Per-day, per-person details** live in `day.staff[id]`:
  - `status`: avail / leave / mc / postcall / elsewhere / admin
  - `leaveTime`, `liverStandby`, `aoh`, `comment`, `notAroundPrev`, `posting` (a junior's posting for that day only)
  - `manual*` / `auto*` flags: values from the monthly rosters are `auto`; anything set by hand is `manual` and wins.
- **Roster cells are text,** exactly as on the sheet. Day details are written into every cell the person is physically in (`syncPersonCells`); covers and posting tags stay per cell.
- **Edit protection:**
  - The staff list and Settings are read-only until Edit.
  - Staff edits are reviewed as a list of changes and logged.
  - Imports go through a review in which nobody is ticked by default; "Always skip" names are remembered.
  - Possible duplicates are only shown on request; merging keeps the other spelling as a short name.
- **Undo and Redo** cover cell edits, Generate new, restoring a saved version and person box changes (Ctrl+Z, Ctrl+Y). Undoing Generate new only brings back the roster; day details changed since stay.
- **The header date** is written out ("Mon, 12 Oct 2026") because the native picker shows mm/dd on some phones. It has ‹ › Today and Tomorrow buttons, warns when the day isn't tomorrow, and says whether the day is saved to the team (a hash of the day and roster at the last save or restore).
- **Tabs:** the daily ones in work order on the left (Monthly, Cases, Roster, Premeds), the set-up ones (Staff, Settings) on the right.
- **Less on screen:** Cases shows only the flags that are on ("+ flag" opens the rest); roster cells show + and the & / C handles on hover. Hovering a name, or opening its box, lights up every cell that person is in.
- **Empty pages** say what's missing and have a button to the tab that fixes it.
- **Steps strip** under the tabs (Monthly, Cases, Roster, Premeds): Monthly rosters → Cases → Roster → Check → Save or download, each done/to do/problem and a button there. A download or print counts as sent until the roster changes (`state.outHash`).
- **Problems card** at the top of the Roster tab's side column: the live checks (recomputed on every render, so a status change on Today shows at once), errors first. `check()` tags each problem with `fix` (`takeOff`, `cover`, `fill`, `reseat`, `premed`), `person` and `rooms`, and the card turns these into buttons, plus Show (scrolls to the room). The generator's own messages go under "Notes from making the roster".
- **Do it all** on Cases: loads the admin draft, makes the roster and opens its problems.
- **Move or swap by tapping:** the roster person box has "Move or swap"; the next tap on a name swaps, on a cell moves, on Admin / no list takes them off (works without dragging, e.g. on phones).
- **The + picker ranks people** for that room: free and suitable first (subspec for seniors, posting match for juniors), then free, then already on a list, then not working, each with a note.
- **Select several** on Today › Manpower moves many people to one group in one step (with Undo); dragging one also has Undo now.
- **Keyboard shortcuts** (? lists them): Ctrl+Z/Y, Ctrl+S save or download, Alt+1–4 tabs, [ and ] previous/next day, / filter.
- **My day** (`#myday`, bookmarkable; a viewer's only page): pick your name once (remembered in this browser, or matched from the member's name) and see where you are on the date on screen: rooms with your partner and case notes, premeds, calls/clinics, leave or admin, notes; then the whole sheet.
  It opens on today before 2pm and on tomorrow after (`MYDAY_SWITCH_HOUR`). Viewers see "Saved by … at …", get the
  latest copy when they come back to the page (after a minute away) or press Check again, and lines that changed since
  they last looked are marked (what each person saw per date is kept in `nuh-roster-seen`, last 60).
- Who "me" is on My day: the staff record an admin links to the account (Settings › Team members › "On the staff list
  as", saved as `members/{email}.staffId`), else the name picked in this browser, else a guess from the member's name,
  which My day flags ("Matched to … Not you? Pick your name").
- Installable and offline (13 Oct): `manifest.webmanifest` (shortcut: My day), icons in `icons/`, and `sw.js` (the
  logbook's pattern: shell cache-first, Firebase SDK cached, big vendor files cached on first use; since 24 Oct 2026 on the shared
  app-update module: a new version takes over at once and the page reloads once, no bar). Its VERSION base is `nuh-roster-v1`; the deploy stamps it, so PRs leave it alone. Not registered at the
  old anawj.com address. Offline, the app opens and My day shows the last roster this phone loaded.
- App version (14 Oct): the bottom of Settings shows "App version <date> (<hash>)" from the `nuh-roster-` cache name and
  "Not updating? Get the latest version": with signal it unregisters the service worker, deletes only `nuh-roster-` caches
  and reloads (data in this browser and sign-in are kept); with no signal it changes nothing. Prewarm's pattern.
- Opening the app on a past date (not today) moves the roster to tomorrow, with a toast to go back.
- My day also has: Add to calendar (an .ics file made in the browser, `js/ics.js`; no feed URL, nothing sent), My
  week (the next 7 days: saved rosters, else leave and calls from the monthly rosters; viewers load the team's copies
  only when they open it) with "Add the week to my calendar", and Copy for logbook on each room (date, room,
  supervisor, case notes, to paste into the logbook's case summary; the apps stay separate).
- **Phones:** the Roster tab shows one card per room (Senior, Junior, case notes) instead of the wide table, and the person box slides up from the bottom.
- **Sending it out:** Download offers .xlsx, PDF, an image for WhatsApp (`js/pngout.js`, drawn from the same layout; shared through the phone's share sheet where it can be, else downloaded) and Print. Printing shrinks the sheet to fit one A4 page.
  A send counts only once it happened (a closed share sheet or a PDF that couldn't load doesn't). What went out is kept
  per date for 30 days (`state.outSent`: rows, time, stamp); after changes the Roster tab lists them ("Changed since sent
  at 07:42") with Send image with the changes (the list goes as the message, or is copied) and Copy, and a sheet sent
  again says "Updated hh:mm" at the top right (`buildLayout({ stamp })`).
- **Learning from hand changes:** taking a senior off a subspecialty list by hand on three different days offers to add it to their "doesn't do" list (`state.learned`; asked once per person and subspecialty).
- **Practice mode** is the demo (`?demo`): a "Practice" button in the header opens it in a new tab, it opens with a 7-step tour once (`localStorage['nuh-roster-tour']`), and Tour in the footer replays it.
- **Undo instead of "are you sure?"** for Generate new, Clear cases, Clear manpower, Reset to monthly rosters and restoring a saved version on the same date: the toast has an Undo button. Confirms stay only for what can't be undone.
- **Person chip and box:** the same chip and box on Today, Cases, Roster, Premeds and Calls/clinics. On Calls/clinics a dashed chip comes from the monthly rosters (or the MOT call team for EOT 8 and 9); × on the only one stores `-` (nobody), and "↺ monthly" goes back to the monthly roster. The name and grade are read-only there; Edit opens the Staff tab on that person.
- **Touch screens:** no dragging, no C / & / × icons. Tapping opens the box.
- **Design:** the NUHS app kit (`https://design.anawj.com/v1/app.css` + `app.js`, linked after `tokens.css`; 15 Oct 2026): on a phone
  it looks like a native app (translucent bar with the kit's four-quarter band, tab bar at the bottom, a large title
  per tab, rounded cards on the grey ground, segmented controls, sheets, the kit's toast); on a computer the tabs are a
  sidebar and the screen keeps the full width (`.a-main--wide`) for the tables. Phone font (system UI), navy tint,
  light only. `style.css` keeps the roster's own names (`--navy`, `--chip`…) as aliases of the kit's colours; the band
  is four equal quarters of orange `#e57200`, red `#e4002b`, blue `#178fd7` (not cyan) and navy `#002f6c`. Banners go in
  `#bars` under the bar; Key and help, Keyboard shortcuts and What's new open as kit sheets (`aSheet.open`).
- **Demo mode** (`?demo`): an invented department about the real size (39 seniors, 50 juniors); on the start day 5 are on leave and 2 seniors on an admin day (every weekday gets 2 senior admins); every monthly roster filled for the chosen month and the months either side (more are made as the date moves on), and made-up case notes for each new day (fewer at weekends). It uses separate storage and never signs in. Bump `DEMO_VERSION` in `js/app.js` when the demo data changes, so open demos start again.
