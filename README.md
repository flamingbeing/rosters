# rosters

Duty-roster web apps of the anaesthesia department, each on its own address:

- [NUH roster](https://nuhroster.anawj.com/) (`nuh-roster/`)
- [NTF roster](https://ntfroster.anawj.com/) (`ntf-roster/`)
- [NUH junior monthly](https://nuhjuniormonthly.anawj.com/) (`nuh-junior-monthly/`)

Static pages served by one Cloudflare Worker (`worker/sites.js`; which folder each address serves is in
`worker/routes.js`). Data lives in each app's Firebase project; this repo holds only code and made-up samples. The
NUHS design kit comes from design.anawj.com. Moved here from anawj-site on 21 Oct 2026 (files only, no history; the
old history stays there). How to work here: [AGENTS.md](AGENTS.md).
