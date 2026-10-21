# NTF Roster: speed

Part of [NOTES.md](../NOTES.md).

## Speed (Oct 2026)

The owner found the first version slow on a phone. What keeps it quick, and what to keep in mind when changing it:

- **Grid edits swap cells, not the grid.** `renderGrid()` builds each person's row from a signature (`rowSig`: their
  cells, the day before the month, problems, details, the selected cell); a row whose signature is unchanged reuses
  last render's HTML, and a changed row swaps only the cells (and footer counts) that differ. The duty-colour
  `<style>`, the toolbar selects and the paint bar are rewritten only when they change (rewriting a `<style>`
  restyles every element on the page). The cell editor is built once and updated in place.
- **Full redraws are progressive** (another month, back from another tab, a filter, Auto-fill or an import changing
  most rows): the rows in the grid's window go in first, then the rest over the next frames; rows above the window
  wait in a spacer (`tr.r-spacer`) sized from the last drawing, and the scroll position is corrected when they arrive.
  Code that needs a row that may not be drawn yet calls `flushRows()` (`selBtn()`, keyboard moves and paint already
  do). The first screen after the app starts is drawn whole.
- **The rule check** (`evaluate`, about 5 ms a month on a laptop) rules out most person-days with one bit test per
  code list (`compileCodes`) and lists each person's request days once (`requests` rules), which also made Auto-fill's
  search about twice as fast with identical results.
- **Start-up**: the first screen's modules are fetched side by side; weekdays and the duty map are memoised in
  `model.js`. The Google Fonts stylesheet in `index.html` is render-blocking (it held the first paint by ~0.4 s on a
  slow connection in testing): self-hosted fonts with `font-display: swap`, or a non-blocking link, remove that.
- **Guard**: `node ntf-roster/test/perf.e2e.mjs` (Playwright, phone size, CPU 4x slower) times tap a cell → editor,
  tap a code → grid, and switch month, against budgets of about 2x the Oct 2026 numbers. Not in the Checks workflow.
- Measured in Chromium at 390 px with the CPU 4x slower (medians, before → after): switch month 0.75 s → 0.32 s
  until the new month shows (about 0.8 s until every row is in, as before); tab to Roster 0.83 s → 0.35 s; tap a code
  → grid 0.35 s → 0.26 s; rule builder live check 0.16 s → 0.07 s; Auto-fill to the preview 3.4 s → 1.1 s (laptop
  2.8 s → 0.7 s). On a laptop: switch month 150 → 70 ms, tab to Roster 150 → 67 ms, tap a code 66 → 43 ms.
