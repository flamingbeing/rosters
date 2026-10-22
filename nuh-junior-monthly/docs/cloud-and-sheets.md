# NUH Junior Monthly: the cloud, Google Sheets and locking

Part of [NOTES.md](../NOTES.md). 

**Google Sheet in and out, straight from the browser** (16 Oct 2026; `js/gsheets.js`, `ui-more.js`). More has "Read from
Google" (paste the sheet link, sign in; scope `spreadsheets` through Firebase Auth's Google pop-up, access token kept in memory
only) and, for a month read that way, "Check, then write" and "Undo that write in Google". Safety, because the sheet must stay
exactly as it is plus the calls: it writes only the changed cells, as plain values (RAW), after (1) re-reading the whole imported
block and checking every name and day cell is still exactly what was read (a moved row or an edit stops it and names the cells),
(2) refusing any cell that holds a formula, (3) a confirmation listing every cell (was, will become), and (4) reading the cells
back. The write is recorded (`sheets[month].lastWrite`) so "Undo" puts back what was there, but only in cells that still hold what
was written. It acts as the signed-in person, so the sheet's sharing and protected ranges still apply. A month read from a paste or
.xlsx has no Google source and keeps the copy-and-paste way. Needs the Sheets API on the Google Cloud project and the scope on the consent screen
(In production, unverified-app notice, 100-user limit): see `OPERATIONS.md`. Untested against real Google in CI (a fake Sheets API in the unit and browser tests).

**Lock a month** (16 Oct 2026): the Lock button at the top sets the month's status to `published`, which the team copy already
stores (no rules change). While locked, `store.commit` refuses any change to that month's days (calls, Auto-fill, import, copy back)
and says why; unlocking asks first. Undo/redo and Restore are not blocked.

**Days around the month** (16 Oct 2026): the Roster grid shows greyed, read-only columns before and after the month (back to
the first working day before it, at least two days; on to the first working day after it), so you can see where people come from,
where they go next and who is post call. They show what is in the app for those dates (so import last month too). "Days around"
in the toolbar turns them off (per device). They are not part of editing, Auto-fill or the copy back to the sheet.

**Team copy of a month = one JSON string** (16 Oct 2026): Save to team failed with "too many index entries for entity /months/…/versions/…":
Firestore indexes every field of a map, and a month's days (days × people × codes) went over its limit of 40,000 index entries a
document. `cells` is now saved as one JSON string (`cloud.js` `cellsFromDoc` reads either form; the rules accept a map or a string
up to 900,000 characters). More shows Team sharing first, with Save to team and Pull from team.

How to add a rule type: as in `ntf-roster/docs/rules.md` ("How to add a new rule type"); the engine is the same file.

## Earlier saves (16 Oct 2026)

More > Team sharing > **Earlier saves** lists the last 20 saves of the month on screen, or of the staff list and rules, with
who saved and when. **Restore** brings that copy into the browser only (Undo puts the current one back); it reaches the team
at the next Save to team. Every save is kept for good for now. Thinning (a Firestore TTL policy on an `expireAt` field: about
60 days, keeping the first save of each week) is planned but not built; the owner asked for a reminder in December 2026.

## Months start locked (16 Oct 2026)

Every month is locked until someone unlocks it (the padlock at the top), and **an unlock lasts one visit**: every month is
locked again whenever the app opens and when it is closed (`store.lockAll`, at start and on `pagehide`; owner, 16 Oct 2026). A
month with no entry yet gets a locked one when it is opened (`store.ensureLocked`). Reading a month in from Google or the
sheet unlocks that one month (it is deliberate). Not in Practice. A month the cloud copy holds as unlocked comes in unlocked
and is locked again at the next close or start. The stored status values are unchanged (`published` = locked), so no rules change.

## The cloud (16 Oct 2026)

**Save and Pull cover all the data** (16 Oct 2026): the staff list, rules and settings plus every month, each month with its days, status and the imported sheet layout (`months/{m}.layout`, a JSON string, so a second device can write to the sheet and hide people the sheet leaves out). A save writes only the months that changed since this browser last saved or pulled (a fingerprint per month in `nuhjm-team-seen`), each with its own conflict check; a pull brings in every month the cloud holds. Months only this browser has are kept.

"Team sharing" became **the cloud** (Save to cloud, Pull from cloud): there is one shared copy, not a group. A **cloud button in
the header** (hidden in Practice and until Firebase is set up) says Saved 2:14 pm, Not saved, Cloud is newer or Cloud differs,
with a dot when something needs doing; it opens the cloud panel (the same panel as More > Cloud: sign in, Save, Pull, Earlier
saves, who saved last and when, when this browser last changed). `js/cloudstate.js` keeps the three times per device
(browser changed, last synced, cloud last known); `ui-team.js` `checkCloud` asks the cloud quietly (4 s after start and when the
tab comes back, once the cloud has been used here). Auto-fill shows only on the Roster tab; a locked month says so on the
roster with an Unlock button. After a verified write to the Google Sheet a toast offers to open the cloud. No autosync: the
status is the safeguard (16 Oct 2026).

## Roles in the cloud (16 Oct 2026)

Admin: everything a rosterer can do, plus adding and removing members, changing roles, approving people who ask to join, and
deleting a month from the cloud (an admin cannot demote or remove themselves, so one always remains). Rosterer: reads and saves
the roster, rules and months; every save is kept in Earlier saves. Viewer: reads and pulls only. Changing the member list is
the owner's call (live changes go through the owner's private helper).

## Locking cells (16 Oct 2026)

A cell's lock (Auto-fill leaves it alone) is the first thing in the cell popup, and Paint has a **Lock** chip: tap or drag
across cells to lock them, tap a locked cell to unlock it. Not to be confused with locking a month (header button).

