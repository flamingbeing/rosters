// Firebase web app config for team sharing (sign-in and the shared roster in Cloud Firestore).
// Filled in 16 Oct 2026 (project "nuh-junior-monthly" created). Without apiKey and projectId the app runs without sign-in and
// everything stays in this browser (move it with Backup); with them, Team sharing in More is on and local use still works.
//
// To switch team sharing on:
//   1. Firebase console: create project "nuh-junior-monthly", add a Web app, turn on Authentication > Google, and add
//      nuhjuniormonthly.anawj.com to Authentication > Settings > Authorised domains (never preview domains).
//   2. Create the Firestore database, then paste the Web app's config below (Project settings > Your apps > Config):
//        apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId
//   3. Add the first admin by hand in the console: members/{your-email-in-lower-case} = { role: 'admin', name: 'You' }.
//   4. Rules: nuh-junior-monthly/firestore.rules deploys on merge once the project has a matrix entry in
//      .github/workflows/deploy-firestore-rules.yml and the rules deployer has Firebase Rules Admin on it.
// These values are public by design (they only name the project); access is controlled by firestore.rules and the
// members list.
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBug_gM5CTOJ0OCF_3h_q1164HlhPIQbzY',
  authDomain: 'nuh-junior-monthly.firebaseapp.com',
  projectId: 'nuh-junior-monthly',
  storageBucket: 'nuh-junior-monthly.firebasestorage.app',
  messagingSenderId: '283183622299',
  appId: '1:283183622299:web:bf6ef90b6522752d6dbe3e',
};
