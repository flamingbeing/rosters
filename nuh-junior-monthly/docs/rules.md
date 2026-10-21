# NUH Junior Monthly: rules

Part of [NOTES.md](../NOTES.md). The Rules tab and how rules are set up.

## Rules (Rules tab; the rosterer changes them)

Cardiac and ICU rules come from past rosters (a C3 and an R1B every night; C3 → PC → back to C; R1B → PC → PPC → ICU;
first calls by experience as in a senior's SICU list). The rest are predictions from the
department's roster guide, marked **To confirm** (note "Predicted…"); the R1–R3 cover and level rules are off until
the rosterer uses the app for them. New rule type here: **`postingStart`** ("no calls in the first N days of a
posting": no ICU call on day 1, new to ICU from day 4 (tag `icunew`), Ortho/HRM residents from day 8 (tag `rrlate`)).
`spread` has an optional `among` (only people on that posting, their share by days on it). Tags `mo1`–`mo3` are the
call levels; `supernum` = in ICU without calls.

**Backtest (15 Oct 2026)**: the app's import, rules and Auto-fill were run on past rosters. Changes it led to are in the rules below (a cardiac call may fall in an echo/perfusion week as a preference against; the Ortho/HRM day-8 ICU rule is a preference; MedHub and liver OT weights; fair shares weight 10; import keeps the posting under leave and blank days; copy-back never writes a posting the sheet didn't show, and leave beats PC). Scripts and numbers: details in the owner's private notes.

**Order of what gives way** (16 Oct 2026): (1) a night with nobody on cardiac or ICU call is never
acceptable; (2) post call as a day off (and the ICU day off after it) is a must-hold that is never waived; (3) call
requests (X) and planner blocks (XX) are preferences (weights 60 and 80), kept when there is room and given up first when
a night would otherwise be empty; (4) "new to ICU: calls from day 4" is a must-hold only for rotating residents and
MOPEXes (rule `r-r1b-new`, `who.onlyGroups`: the person must be in one of those groups and also match the tags); for
anaesthesia residents it is a preference (`r-r1b-new-res`, weight 30). Saved states from before get this once
(`rulesVersion` 2 in `model.js`). **EOD call** (16 Oct 2026): a call right after the post call day. Never a call on the post call day itself (must-hold,
`r-postcall`, `r-r1b-gap`, `r-c3-gap`). The day off after an ICU post call (PPC) and the 3-day cardiac gap give way only as a
last resort: `r-ppc` and `r-c3-eod` are preferences at weight 500, so Auto-fill uses an EOD call only when no one else can cover
the night, and Check lists each one. (Same-day rules now see the PPC day off: before this, PPC in a same-day rule matched
nothing.) Saved states get this once (`rulesVersion` 3). A call on the first day of ICU (`r-r1b-d1`) is also a last resort now (preference, weight 400): at a rotation change everyone on ICU can
be on day 1. Import last month's tab first so postings that carry over are not mistaken for new ones (the import review says
so when last month is missing). A night with nobody eligible at all is still left empty and flagged.

Google Sheet read/write, locking, days around the month and the team copy are in [cloud-and-sheets.md](cloud-and-sheets.md).

