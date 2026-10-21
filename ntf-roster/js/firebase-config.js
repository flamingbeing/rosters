// Firebase web app config for team sharing (sign-in and the shared roster in Cloud Firestore).
// Filled in 19 Oct 2026 (project "ntf-roster" created). Without apiKey and projectId,
// the app runs without sign-in and everything stays in this browser (move it with Backup).
//
// To switch team sharing on:
//   1. Firebase console: create project "ntf-roster", add a Web app, turn on Authentication > Google, and add
//      ntfroster.anawj.com to Authentication > Settings > Authorised domains (never preview domains).
//   2. Create the Firestore database, then paste the Web app's config below (Project settings > Your apps > Config):
//        apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId
//   3. Add the first admin by hand in the console: members/{your-email-in-lower-case} = { role: 'admin', name: 'You' }.
//   4. Rules: ntf-roster/firestore.rules deploys on merge once the project has a matrix entry in
//      .github/workflows/deploy-firestore-rules.yml and the rules deployer has Firebase Rules Admin on it.
// These values are public by design (they only name the project); access is controlled by firestore.rules and the
// members list.
export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyC2s1meqHtiUPkxHBzT4bEjA-D4s3c6i48',
  authDomain: 'ntfroster.anawj.com',   // sign-in helper pages served on this host (ntf-auth/, worker/routes.js)
  projectId: 'ntf-roster',
  storageBucket: 'ntf-roster.firebasestorage.app',
  messagingSenderId: '127001041489',
  appId: '1:127001041489:web:cdc720b68c50af376af670',
};
