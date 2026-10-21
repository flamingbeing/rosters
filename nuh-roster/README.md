# NUH Roster

Drafts the NUH anaesthesia department's daily roster and downloads it as `.xlsx` or PDF in the department's layout. Live at <https://nuhroster.anawj.com/>. Try it with made-up data at <https://nuhroster.anawj.com/?demo>. The old address, `anawj.com/nuh-roster/`, sends people on to the new one.

Background, department rules, file formats and the decisions behind the app are in [NOTES.md](NOTES.md). Read it before changing anything here.

## Flow

1. **Staff** (press Edit first). Import the department contact list or a staff sheet; each person is reviewed before anything is added. You can also learn names from past rosters. Then set grades, subspecs and short names on Seniors and Juniors, and postings on the Postings subtab. *Find duplicates* merges people entered twice.
2. **Monthly**. Import the HMS monthly rosters (Junior, Senior, Liver, Leave, AOH; PDF or Excel), or type them in. **Today** shows the day's manpower board (Working, Leave, MC, Post call, Admin) and the calls and clinics, filled from those rosters. Changes made by hand win.
3. **Cases**. Load the admin draft or tick the running rooms, type case notes, and fix people to rooms if needed.
4. **Roster**. Generate, then edit: drag names, use C for an ad hoc cover, & for a double cover, × to take someone off. Tap a name for their box. *Fill empty gaps* keeps what's there, and Undo works for everything. Download the result as .xlsx or PDF, or print it.
5. **Premeds**. Check and fill premed cover.

## Code

See the code map in [NOTES.md](NOTES.md#code-map). Vendored libraries:

- ExcelJS 4.4.0 (MIT)
- pdf.js 3.11.174 (Apache-2.0)
- jsPDF 2.5.1 (MIT)

Tests: `node nuh-roster/test/engine.test.mjs` (fake names only).

## Team sign-in (optional)

With a Firebase project configured, rosterers sign in with Google. Then:

- the staff list, rooms, settings and monthly rosters are shared (*Save for the team* on the Staff or Settings tab)
- each day's roster has a **Save** button, records who saved it and when, and keeps a permanent history of every save
- anyone on the team can restore any saved version

Only Google accounts on the team list can read or write anything. This is enforced by `firestore.rules` on Google's side, not just by the page. Without a config the page works as before, with everything kept in the browser.

The data (staff names, leave, case notes) is then stored in Google Cloud, outside NUH systems. Check with the department that this is acceptable under PDPA and hospital policy before you use real names.

### Setup (about 10 minutes, once)

1. Go to <https://console.firebase.google.com>, **Add project** (e.g. `nuh-roster`). Google Analytics isn't needed.
2. **Build → Authentication → Get started → Sign-in method → Google → Enable**, then Save.
   Under **Authentication → Settings → Authorized domains**, add `nuhroster.anawj.com` (the app's address; `anawj.com` was the old one).
3. **Build → Firestore Database → Create database**. Pick a Singapore location (`asia-southeast1`) and start in **production mode**.
   The rules in `nuh-roster/firestore.rules` deploy automatically on every merge to main (GitHub Actions); never paste them by hand.
4. Add yourself as the first admin. In **Firestore → Data → Start collection**, use collection ID `members`, document ID = your Google email in lowercase (e.g. `you@gmail.com`), and fields `role` (string) = `admin` and `name` (string) = your name.
5. Go to **Project settings (gear) → General → Your apps → Web (`</>`)** and register an app (no hosting needed). Copy `apiKey`, `authDomain`, `projectId` and `appId` into `nuh-roster/js/firebase-config.js`, then commit.
   These values are meant to be public. Access is controlled by the rules and the members list.
6. Open the page, **Sign in with Google**, and add the other rosterers under **Settings → Team members**.
