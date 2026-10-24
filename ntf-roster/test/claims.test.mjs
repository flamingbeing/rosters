// Role claims (js/cloud.js): when the page asks the Worker again, and the members entry's v. Run: node ntf-roster/test/claims.test.mjs
import assert from 'node:assert/strict';
import * as C from '../js/cloud.js';

let n = 0;
const ok = (v, name) => { n++; assert.ok(v, name); };
ok(C.claimsBehind({ role: 'viewer', v: 1 }, {}) && C.claimsBehind({ role: 'viewer' }, { email: 'a@b' }), 'claims: a member with no claim asks');
ok(!C.claimsBehind({ role: 'viewer', v: 2 }, { g: { _: 'viewer' }, v: 2 }) && !C.claimsBehind({ role: 'viewer' }, { g: { _: 'viewer' }, v: 0 }), 'claims: an up-to-date claim does not ask');
ok(C.claimsBehind({ role: 'viewer', v: 3 }, { g: { _: 'rosterer' }, v: 2 }), 'claims: an entry ahead of the claim asks');
ok(C.claimsBehind(null, { g: { _: 'viewer' }, v: 1 }) && !C.claimsBehind(null, {}), 'claims: removed with a claim asks (to clear it); never a member does not');
ok(C.nextV(null, 'viewer') === 1 && C.nextV({ role: 'viewer', v: 4 }, 'viewer') === 4 && C.nextV({ role: 'viewer', v: 4 }, 'admin') === 5 && C.nextV({ role: 'viewer' }, 'admin') === 1, 'members: v starts at 1 and goes up by one on a role change');
console.log(`ntf-roster claims: ${n} checks passed`);
