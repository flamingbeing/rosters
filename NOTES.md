# Notes

Lasting rules, owner preferences and lessons (never task chatter), and how to test.
- `lib/exceljs.min.js` is not in any `sw.js` SHELL or stamp hash: the apps cache it on first use. If it is ever
  updated, bump the three VERSIONs' base names (e.g. `-v2`) so phones fetch the new copy. `lib/package.json` makes Node
  read it as CommonJS (the repo is `"type": "module"`), for the unit tests that load it.
- Browser tests load the design kit from design.anawj.com (live), so they need the network.
