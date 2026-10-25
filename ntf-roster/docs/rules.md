# NTF Roster: Rules: engine, sharing, plain sentences, per-roster rules

Part of [NOTES.md](../NOTES.md). How rules work: the engine and how to add a rule type, sharing rules as text, rules as plain sentences, the confirmed rules and the Priorities sheet, and why each roster has its own rules.

## Rules engine (`lib/roster-core/rules.js`, wrapped by `js/rules.js`)

The engine is the roster core's, shared with nuh-junior-monthly; `js/rules.js` only gives it this app's options (request
priorities for Cr and Nc, "consultants" in the words). The other app's extras (posting duties, PPC, the full fair-share
rule, two more rule types) are options this app leaves off.

Every rule is plain data: `{ id, type, name, enabled, hard, weight, who, when, params, note }`. `who` picks people
(groups, tags, named people, except); `when` picks days (from/to, weekdays, public holidays any/only/exclude). Hard
rules must hold (each break costs 1000); soft rules (preferences) cost their weight (1 to 100).

Ten types, all in `RULE_TYPES`: **cover** (how many people on a code each day), **limit** (per person per week,
month or rolling window, optionally scaled by FTE or days in post), **sequence** (day-after rules: if X then not / must
Y on the next days, or days before), **sameDay** (combinations on one day), **together** (pairing between people:
never together / needs someone), **maxRun** (consecutive days), **requests** (honour a request code, by day or
weekend), **spread** (share fairly; always soft), **eligible** (only these people may have a code), **standing**
(a fixed duty on given weekdays). Code lists may use tokens: `@shift`, `@leave`, `@other`, `@request`, `@away`
(leave, other or post call), `@present` (a shift, or a normal weekday and not away), `@any`, and `x`.

How it checks: `evaluate()` builds a grid of effective codes for the month plus a week either side, or further when a
rule reaches further back (`ruleReach`: the longest day-after offset, rolling window or run) (bit flags per
person-day, so token tests are one AND), compiles each enabled rule into a small evaluator (per day, per person or
global), and collects violations with plain-English messages ("Tue 3 Nov: 1 junior on Call, needs 2"). A month of
80 staff × 31 days × 23 rules takes about 5 to 10 ms, so the app re-checks on every edit. Requests count as codes when
rules are checked (a rule on `Nc` matches people who asked for no call), and post call counts as away (a `standing`
rule is met on a post-call day).

Edges of the month (review, 15 Oct 2026): only what can be changed inside the dates checked counts. Last month's
excess over a week or rolling limit is last month's problem; a minimum for a week or window running into next month's
unplanned days is scaled down (rounded down); a weekend request on Sat 31 Oct covers Sun 1 Nov; a call on the 30th
before a clinic already planned on the 1st is flagged in this month (post call). One duty over a rolling limit costs
one unit however many windows it sits in. Problems about a person's whole month (fair share, a monthly minimum) have
no date: the grid marks the name with a dot and Check's Show opens their month. A rule that can't be checked (a
damaged rule from a file) is skipped and listed (`evaluate().failed`), and the header says "Rule check failed" rather
than "No problems" if the check itself breaks. Rules and duty codes from files, backups and the team are cleaned on the
way in (`cleanRule`, `cleanDuty`, `migrate`).

### How to add a new rule type (step by step)

Do this only when the owner wants a kind of rule that none of the ten types can express (most new rules are just a
new rule of an existing type, made in the app). The comment block at the top of `lib/roster-core/rules.js` is the reference.

1. **Name it.** Pick a short camelCase type key (e.g. `minGap`) and the plain-English label the builder shows.
2. **Add one entry to `RULE_TYPES` in `lib/roster-core/rules.js`** (both apps get it; one only one app should have goes in the
   optional list there, `cfg.types`), next to a similar type to copy from (`maxRun` is a short
   person-scoped example; `cover` a day-scoped one; `spread` a global one):
   - `label`, `icon` (an emoji), `help`, `example`: the words on the "Add rule" picker.
   - `params`: the form, as a list of ParamSpecs (`{ key, label, kind, options?, min?, max?, optional?, help? }`
     with kind `codes`, `code`, `number`, `select`, `who` or `bool`; the `P.codes`, `P.num` and `P.sel` helpers make
     the common ones). The rule builder (`js/ui-rules.js`) draws its form from this list, so no UI code
     is needed. A param that only matters for some settings can be hidden with an entry in `SHOW_IF` in `ui-rules.js`.
   - `defaults()`: a fresh params object.
   - `scope`: `'day'`, `'person'` or `'global'` (what one evaluation covers; the solver re-checks only what a change
     touches). `soft_only: true` if it can never be hard.
   - `describe(rule, T)`: one short sentence, using `T.codes()`, `T.who()` and `withWhen()` like the others.
   - `validate(rule, state)` (optional): problems beyond the generic checks ("At most must be 1 or more").
   - `compile(rule, X)`: returns an evaluator with `day(d, out)`, `person(p, out)` or `global(out)` that returns the
     penalty (`X.u` per unit), bumps `X.ctx.n2` per violation, and only when `out` is given pushes
     `X.V(pen, msg, { date, staffId, dates?, staffIds? })`. Return `null` when the rule can't apply (no codes).
     Report only days between `ctx.lo` and `ctx.hi` (the month on screen); the days around it are context.
3. **Test it** in `test/rules.test.mjs`: a passing and a failing case, the `describeRule` sentence, and a
   `validateRule` case. Run `node ntf-roster/test/rules.test.mjs`, then `node ntf-roster/test/solver.test.mjs`; both apps'
   `test/core-pins.test.mjs` then show the new `types` entry (re-record them with `--write`, a meant change).
4. **Check it in the browser**: Rules › Add rule shows the new card; build one in `?demo` and see its problems in the
   grid and in Check. If Auto-fill should be able to satisfy it (not just score it), check `js/solver.js` step 2: only
   `cover`, `standing` and minimum `limit` rules create demand; everything else is scored.
5. **Give it a sentence**: one entry in `TEXT_FORMS` in `js/rules-text.js` (the words for Edit as text and the
   readable file; `test/rules-text.test.mjs` fails until there is one), and a case in that test's list.
6. **Document it**: one line in the rule-type list above and in the table in `SPEC.md`.

Nothing else changes: the checker, the builder, Check and the solver all read `RULE_TYPES`.

## Sharing rules as text (`js/rules-share.js`)

Rules > Copy puts the rules (JSON, same shape as the Export file) on the clipboard; Paste / import takes pasted text or a
file, accepts the export shape, a bare list, one rule, or a Claude reply with the JSON in a code block, and opens the
review: plain-English problems per rule (unknown type or code; those are not importable), a dry run (how many problems
the rule would flag this month as the roster is now), New / Changed / same. A rule without `pool` goes to the roster in
view. "Guide for Claude" copies a Markdown guide built from `RULE_TYPES` (every type, field and option) plus this
roster's codes, groups and tags (no staff names), so a new rule type appears in it by itself. Priorities: select by type,
clear selection, saved selections (per device, `ntf-roster-rq-sets`).

## Rules as plain sentences (20 Oct 2026, `js/rules-text.js`)

The owner: rules must be easy for a person to read and change. Every rule can be written as one exact sentence and
read back as the very same rule (`test/rules-text.test.mjs` checks every default rule and every option of every type).

- **Line format** (Rules › Edit as text, for the roster in view):
  `MUST  Name = Juniors: at most 7 C a month, scaled by FTE (weekends)  // note  [r-maxcall]`. Status first: `MUST`,
  `PREF 20` (a preference with priority 20), `OFF` in front for a rule turned off. `Name =` and `// note` are optional;
  who goes before the colon (left out for everyone; names of groups, tags, people, or `juniors`/`seniors`; `except`
  names people left out; a name that is two things is written `group …`/`tag …`/`person …`); when goes in brackets at
  the end (`weekends`, `Mon, Wed`, `weekdays, except public holidays`, `public holidays only`, `from 2026-11-01`,
  `until …`). Codes are the roster's own codes or the words for tokens (`any shift`, `leave`, `away`, `at work`,
  `post call`, `other duty`, `a request`, `anything`). Each type's sentence is a pattern in `TEXT_FORMS`.
- **Editing**: the `[id]` ties a line to its rule; a line without one (or a copy of a line) is a new rule; a removed
  line deletes its rule. Settings a sentence doesn't show (the run length of a weekly limit, the number on a "never
  with" rule) stay as they were. Review is the import review plus Delete rows, and saving is one undo step. A line
  that can't be read is named ("Line 12: …") and stops the review: nothing is guessed, and its rule is never deleted.
  A rule that can't be written exactly (no codes yet, an unknown person) is a `# Kept as it is … [id]` line.
- **Readable file** (Rules › Export as text): one block per rule, `- name:` then `strength`, `on`, `roster`, `who`,
  `rule`, `when`, `note` (more lines indented four spaces), `id`; a rule that can't be written gets a `json:` field.
  Paste / import reads this file, rule lines, or JSON (`looksLikeRulesFile`, then lines starting with MUST/PREF).
- **Rule builder** (`sentenceEditor` in `ui-rules.js`): the rule at the top as the same sentence with blanks. Who, codes
  and when open their picker below the sentence; numbers, choices (exactly / at least / at most / between, per week…)
  and switches (scaled by FTE) are edited in place. Every field is under "Advanced: every field" (open when a template
  asks to pick people); each side redraws the other. Drawn from `TEXT_FORMS`, so a new type gets its sentence there.
- JSON copy, export and the Guide for Claude are unchanged.

## Rules: all confirmed, Priorities sheet (19 Oct 2026)

- The owner confirmed every rule: no "To confirm" tag or Confirm buttons any more. Older saves drop the old
  "Predicted from the drafted rules" sentence from rule notes once (`settings.rcv`); the junior rules no longer carry it.
- Rules › Priorities (`ui-ruleprio.js`): every rule as a bar (preferences by priority, then must hold, off greyed).
  Drag a bar to change one; tick several to set a priority, raise or lower by 10, make must hold or preference, or turn
  on or off together (`bulkSet`; share-fairly rules stay preferences).
- Rules can be dragged by their grip (⠿; arrow keys on a focused grip) to reorder them, or between Preferences and
  Must hold (`placeRule`). A dropped preference keeps its priority if it already fits between its new neighbours,
  otherwise gets the midpoint; ties are ordered by the rules list, so the rule also moves there (the Rules tab sorts
  the same way). Drag listens on the window: moving the row in the page drops pointer capture.

## Each roster has its own rules (19 Oct 2026)

- The owner: the junior and senior rosters are different institutions, so their rules are separate. Every rule has
  `pool` ('junior' or 'senior') and only ever covers that roster's people.
- Older saves and imported rule files are placed once on load (`M.splitRules`, run by `migrate` for any rule without
  a roster): the known defaults by id, others by who they name (groups by kind, junior-pool tags, people by their
  roster). A rule about everyone, or both, becomes two: the junior copy keeps the id, the senior copy gets `<id>-s`.
- Engine: `scopeToPool` leaves the other roster's rules out of a Junior or Senior check or fill; in All each rule gets
  `who.only` (its roster's people, honoured by `compileWho`; never saved). The "other people" side of a Between-two-people
  rule is not narrowed (the Baby MO rule may name seniors).
- Rules tab and Priorities show the roster picked at the top (All shows both, each with a Junior/Senior roster tag);
  bulk changes only reach the rules shown. The rule editor has a Roster field; requests take the person's roster.
- Cloud merge by pool now keeps my roster's rules and takes theirs for the other, by `pool`.
- The demo no longer puts senior residents on the junior call (they are on the senior roster since 19 Oct).
