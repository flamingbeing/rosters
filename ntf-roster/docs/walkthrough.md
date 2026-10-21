# NTF Roster: walkthrough

Part of [NOTES.md](../NOTES.md).

## Walkthrough (first-time help: `js/guide.js`, `js/tour.js`)

The owner asked for a walkthrough for a first-time user (15 Oct 2026). Four parts, all in the NUHS look (square panels
with a navy top rule, navy titles and primary buttons, only controls rounded), like the NUH roster's Practice tour:

- **Getting started** (your own roster only, never practice): the welcome screen of an empty roster, then a card at the
  top of Roster with six steps that tick themselves off: staff added; People › Duty codes opened; a rule opened in
  Rules; any leave or request; an Auto-fill applied (auto codes in the cells); an export, print or backup. The three
  that the data can't show, plus Hide and "finished", are kept in `state.settings.onboarding` (so they travel with
  backups and team sharing) through `store.mark()`, which is not an undo step. All six done: "All set" for a few
  seconds, then the card goes; Help › Getting started checklist shows it again. Laptops show the steps as a row with
  the open one's words below; phones and the welcome screen as a list. Folded or open is per device
  (`ntf-roster-guide`; folded by default on phones). Edit the steps in `STEPS` at the top of `guide.js`.
- **The tour** (coach marks): `TOUR_STEPS` at the top of `tour.js` is the step list: `{ id, title, text, target, tab,
  maxH, count, only, phone, laptop }` (`only: 'laptop'` for a stop that is only at that size, like People). `target` is the value of a `data-tour="…"` attribute (add one to the control you want
  lit), or a list where the first is the step's own control and the rest are lit too (the tab that leads there);
  `phone` / `laptop` replace fields at that size; a step whose control isn't on screen is skipped. It switches tabs as it
  goes (replacing the history entry, so Back still works) and its own history entry means the phone's Back ends it; at
  the end the app is back where the tour started and focus returns to the button that opened it. Keys: → or Enter
  next, ← back, Esc skips. The card docks above the tab bar on phones. Practice opens it once per device; your own
  roster offers "Take the 1-minute tour" on the checklist (with no staff yet it opens practice in a new tab, where every
  control has something to point at). Seen or skipped: localStorage `ntf-roster-tour` = `{ v, done }`; bump `TOUR_V`
  to show a changed tour to everyone again. It never touches roster data, and the app's own keys (Ctrl+Z included)
  wait while it is open. Next takes focus (with its ring) only for keyboard use; after a tap, or when practice opens it
  by itself, the card itself does. Crossing 720 px mid-tour redoes the step at the new size.
- **Try it yourself** (practice only): three tasks in a small card, each ticked from store changes: give someone leave,
  add a "never on call together" rule for two named juniors (Rules › Add rule › Between two people, which now starts
  as never on Call), Auto-fill next month and Apply. "Show me" lights the control to tap next, inside a window too: the
  task card sits above windows (z-index 81, below the tour), which make room for it underneath. A tick's few seconds
  start once no window is open, so it is seen. `?demo&try` starts it,
  `?demo&tour` the tour (links from your own roster's Help).
- **Help**: the "?" in the header (on phones too) opens a sheet: Take the tour · Try it yourself · Getting started
  checklist · Keyboard shortcuts (not on touch-only phones; the `?` key still opens them). On phones Getting started
  also shows above Day, where the app opens. More › Help has "Show the walkthrough".
- Test: `test/tour.e2e.mjs` (in Checks). `test/e2e.mjs` and `test/perf.e2e.mjs` mark the tour as seen first, so practice
  doesn't open it under them.

Lesson (17 Oct 2026): a closed sheet or picker stays in the page for a moment with `.out` on its backdrop. Any code that
looks for "the open sheet" (Show me in `js/guide.js`) must skip elements inside `.out`, or it picks the closing one and
the tour test flakes on slow CI.
