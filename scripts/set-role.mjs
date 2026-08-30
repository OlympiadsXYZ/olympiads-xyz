#!/usr/bin/env node
// Set (or clear) a staff role on a user via Firebase custom claims.
//
//   node scripts/set-role.mjs <email> admin|author|none
//
// Requires a service-account key for the olympiads-xyz Firebase project:
//   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccountKey.json
// (Console → Project settings → Service accounts → Generate new private key.)
import admin from 'firebase-admin';

const [email, role] = process.argv.slice(2);
if (!email || !['admin', 'author', 'none'].includes(role)) {
  console.error('Usage: node scripts/set-role.mjs <email> admin|author|none');
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.applicationDefault() });

const user = await admin.auth().getUserByEmail(email);
const claims =
  role === 'none'
    ? {}
    : role === 'admin'
      ? { admin: true }
      : { author: true };
await admin.auth().setCustomUserClaims(user.uid, claims);
console.log(
  `${email} (${user.uid}) → claims ${JSON.stringify(claims)}. ` +
    'The user must sign out/in (or refresh their token) to pick it up.'
);
process.exit(0);
