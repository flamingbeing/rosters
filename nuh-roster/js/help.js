// The words the app shows to explain itself: the key to the roster's marks, "How do I…?" answers, and What's new.
// Data only (the dialogs are in app.js). Keep entries to what the roster does; no guessed expansions of abbreviations.
import { POSTINGS } from './engine.js';

// The key: what the roster's marks and words mean, then short answers to "How do I…?", one open at a time.
export const SYMBOLS = [
  ['&', 'Double covering: this senior has two rooms (a dark & on the Roster tab). Drag the & to give them another room.'],
  ['Name (C)', 'Ad hoc cover: a junior from a nearby room covers this one (shown in red). Drag the C on a junior to add one.'],
  ['C-OT13', 'Covers OT 13 when its person leaves early.'],
  ['L-4pm', 'Leaves at 4pm (L-4-5pm: away 4 to 5pm).'],
  ['(L)', 'Liver standby: kept off complex lists. On a junior with a Liver posting it is their posting.'],
  ['(RA) (P) (SR)…', `A junior's posting this week: ${POSTINGS.filter(([k]) => k).map(([k, l]) => `${k} ${l}`).join(', ')}.`],
  ['(AOH)', 'On the AOH list that day (AOH Monthly).'],
  ['-mtg 3pm', 'A comment, also listed in the comments box.'],
  ['Green name', 'Baby MO: a new MOPEX who is never left alone, so their senior doesn\'t double cover.'],
  ['Purple name', 'Locum.'],
  ['Red room', 'A remote case (outside the OT complexes).'],
  ['Red name (Monthly)', 'Not matched to the staff list: use Fix names.'],
  ['☾ and •', 'On a monthly roster: ☾ an overnight duty (post call the next day); • fills the calls and clinics on Today.'],
  ['Subspec', 'A senior\'s subspecialty (Paeds, Cardiac, Neuro…). Some lists need one.'],
  ['AOCC', 'One senior and two juniors, taken after the OT lists.'],
  ['AIC', 'One consultant (SC or C), else a senior resident.'],
  ['AH OT', 'Filled by hand.'],
  ['MOT / SICU', 'The call teams at the top of the sheet (Calls and clinics).'],
  ['Premed', 'A junior who wasn\'t around yesterday needs a premed cover (Premeds tab).'],
];
export const HOW = [
  ['make tomorrow\'s roster?', 'Cases › "Do it all" with the admin draft. It reads the rooms and leave, makes the roster and opens its problems. Fix those, then Download or Save for the team.'],
  ['fix a problem?', 'Each problem on the Roster tab has a button: Take off, Fill empty gaps, Swap for someone suitable. Show finds the room.'],
  ['move or swap two people?', 'Tap a name, then Move or swap, then tap the other name or an empty cell. With a mouse you can drag names.'],
  ['say someone leaves early?', 'Tap their name: Leaving (L-), e.g. 4pm. If someone covers, put the room in their Covering (C-).'],
  ['put someone on leave for several days?', 'Monthly › Today, tap them, pick Leave (or Admin) and set "Same until". Leave from the HMS leave roster comes in by itself.'],
  ['take back a change?', 'Undo at the bottom, or Ctrl+Z. Everything can be undone until you change the date.'],
  ['send it on WhatsApp?', 'Download › Image for WhatsApp (or Image in 2 parts, easier to read on a phone). After changes, "Send image with the changes" lists what moved.'],
  ['see only my own day?', 'My day (footer): pick your name once. It shows your room, partner, cases, calls, and your week.'],
  ['practise without touching the real roster?', 'Practice (top right) has made-up staff, a tour and a "Fix 3 problems" exercise.'],
];
// What changed for the people using it, newest first. Shown once per device after an update (WHATS_NEW_KEY), and
// always from Key and help. Add a line here when a change is something a rosterer or viewer would notice.
export const WHATS_NEW = [
  ['13 Oct 2026', [
    'My day opens on today in the morning, shows when the roster was saved and marks what changed since you looked; My week, Add to calendar and Copy for logbook.',
    'The roster says when this browser stops saving, and keeps a copy of damaged data.',
    'New live checks: a double-covered room with no junior, a senior in three rooms, an admin day on a list.',
    'After a change, "Changed since sent" lists who moved; a sheet sent again says "Updated" with the time; the image can go in 2 parts.',
    'The generator prefers SC/C for complex lists and double covers, and says why when you hover a name.',
    'Monthly rosters mark clashes (leave, a day duty after a night) and show which rosters are loaded; leave per day; rotation counts.',
    'Fix names after an import; "Same until" for several days; Start from last week or from the last roster.',
    'Phones: bigger buttons, no zooming, Cases as cards, a Next step bar; installable on the home screen and works with poor signal.',
    'Key and help, a printable guide, Practice exercises and scenarios.',
  ]],
];
