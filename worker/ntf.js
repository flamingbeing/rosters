// NTF roster's claims routes (worker/members.js): POST /api/claims and POST /api/members/sync on ntfroster.anawj.com
// only. Worker secrets NTF_SA_EMAIL and NTF_SA_KEY (a service account of its Firebase project); without them both routes
// answer 503 and the pages use the members entry, as before.
import { memberClaims } from './members.js';
import { FIREBASE_CONFIG } from '../ntf-roster/js/firebase-config.js';

export const { ORIGIN, claimFor, setup, claims, membersSync } = memberClaims({
  origin: 'https://ntfroster.anawj.com', project: FIREBASE_CONFIG.projectId, secrets: ['NTF_SA_EMAIL', 'NTF_SA_KEY'] });
