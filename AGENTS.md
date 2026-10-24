# rosters

Instructions for every AI assistant working here (Claude Code reads this through `CLAUDE.md`).
The duty-roster apps of the anaesthesia department, one Cloudflare Worker for all three:

| App | Folder | Address |
| --- | --- | --- |
| NUH roster (AOCC/AIC monthly roster) | `nuh-roster/` | nuhroster.anawj.com |
| NTF roster (NTF monthly duty roster) | `ntf-roster/` | ntfroster.anawj.com |
| NUH junior monthly (cardiac and ICU calls into the department's sheet) | `nuh-junior-monthly/` | nuhjuniormonthly.anawj.com |

Each app has its own Firebase project and its own `firestore.rules`. Read the app's `NOTES.md` and `STATUS.md` first.

## Public here, private elsewhere

Anything merged here is public. Keep only code, docs, general rules and **made-up** sample data. Never commit
secrets, tokens, personal data, real names or patient details. Private notes belong in the owner's private notes
repo; never copy anything from there into this repo, a PR or an issue (neutral pointers like "ask the owner" are fine).

## Rules that bite

- Each host serves only its own folder (`worker/routes.js` `SITES`); `/lib/` (one copy of exceljs for all three) is
  the only shared folder. Never put an app's own file in `lib/`: nuh-roster has its own `vendor/` at `/vendor/`.
- The NUHS design kit is loaded from `https://design.anawj.com/v1/` (another repo); never copy it in. A kit change
  that breaks these pages goes to `/v2/` there.
- ntfroster.anawj.com signs in through its own host: `__/auth/` (Firebase's helper pages) and `ntf-auth/firebase/init.json`
  are served there. The other two sign in on `<project>.firebaseapp.com`.
- Each `sw.js` VERSION starts with its folder name and is stamped at deploy (`tools/stamp-versions.mjs`, which also
  writes MANIFEST), never by hand. The logic is the shared update module (app-update, exact pin
  `core.anawj.com/update/<x.y.z>/`): every SHELL file must exist and answer without a redirect (install is all or nothing).
- Rules changes: `deploy-firestore-rules.yml` deploys them live on merge (keyless sign-in, GitHub's OIDC token). Test
  them first with `tools/test-rules.sh` (local emulator, needs Java); a manual run deploys all three: ask the owner.
  nuh-junior-monthly's rules are built: edit `firestore.app.rules` and rebuild (its NOTES.md "Roles and the rules kit").
- `worker/claims.js` and `worker/custom-token.js` are app-devkit copies (version line on top): never edit them here;
  take a new kit version instead (Checks diffs them against the pinned kit).

## Checks before merging

```
node tools/check.mjs                          # repo checks + Worker tests
for f in */test/*.test.mjs; do node "$f" || break; done   # unit tests
node tools/proofread.mjs                      # page and doc mistakes
python3 -m http.server 8080 &                 # then the touched app's browser tests, e.g.
node ntf-roster/test/e2e.mjs                  # (PLAYWRIGHT_PATH=... CHROMIUM_PATH=... in a cloud session)
bash tools/test-rules.sh                      # when a firestore.rules changes
```

## Working with the owner

- Instructions mostly come from a phone. Work through a request to the end; ask only when a decision is genuinely
  the owner's. When asked to plan, plan and wait.
- Keep each PR small and finished on its own. Start PR titles with the app: "<App>: …".
- Merge your own PRs once the checks pass, then report with the PR link (merge by the number the PR creation
  returned). After opening a PR, call `unsubscribe_pr_activity` at once: each PR event re-sends the whole context.
- Push once per finished step, not after every small commit (limited build minutes).
- Each app keeps `NOTES.md` (lasting decisions, how to test) and `STATUS.md` (now, waiting on the owner, next,
  dated decisions). Read them before starting; update them when a task finishes. Cheap end of session: `quick-save`.
- Plain words, short; explain technical terms briefly the first time.

## Token savers

- One repo per session: `.claude/settings.json` is only read when a session has exactly one repo attached.
- `.claude/settings.json` denies reading `__/` and `vendor/` folders. Add generated files and very large files to its
  `deny` list (edit their build scripts instead), and say so here. Ask the owner if one is really needed.
- Run only the touched app's tests while iterating and the full run once before merge. Screenshots only for visual
  changes (one, viewport-sized); debug logic with text.
