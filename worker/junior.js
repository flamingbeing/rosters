// NUH junior monthly's claims routes (worker/members.js): POST /api/claims and POST /api/members/sync on
// nuhjuniormonthly.anawj.com only. Worker secrets JUNIOR_SA_EMAIL and JUNIOR_SA_KEY (a service account of its Firebase
// project); without them both routes answer 503 and the pages use the members entry, as before.
import { memberClaims } from './members.js';
import { FIREBASE_CONFIG } from '../nuh-junior-monthly/js/firebase-config.js';

export const { ORIGIN, claimFor, setup, claims, membersSync } = memberClaims({
  origin: 'https://nuhjuniormonthly.anawj.com', project: FIREBASE_CONFIG.projectId, secrets: ['JUNIOR_SA_EMAIL', 'JUNIOR_SA_KEY'] });
