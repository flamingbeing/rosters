// NUH roster's claims routes (worker/members.js): POST /api/claims and POST /api/members/sync on nuhroster.anawj.com
// only. Worker secrets ROSTER_SA_EMAIL and ROSTER_SA_KEY (a service account of its Firebase project); without them both
// routes answer 503 and the pages use the members entry, as before.
import { memberClaims } from './members.js';
import { FIREBASE_CONFIG } from '../nuh-roster/js/firebase-config.js';

export const { ORIGIN, claimFor, setup, claims, membersSync } = memberClaims({
  origin: 'https://nuhroster.anawj.com', project: FIREBASE_CONFIG.projectId, secrets: ['ROSTER_SA_EMAIL', 'ROSTER_SA_KEY'] });
