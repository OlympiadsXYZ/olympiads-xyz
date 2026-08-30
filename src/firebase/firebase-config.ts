import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

// Fallbacks are the public web-app config for the olympiads-xyz Firebase
// project (shipped in every page bundle); env vars still override them.
const firebaseConfig = {
  apiKey: process.env.GATSBY_FIREBASE_API_KEY ?? 'AIzaSyC1W1cboNnqjEp7URXHj7myUogk-etz-f0',
  authDomain: process.env.GATSBY_FIREBASE_AUTH_DOMAIN ?? 'olympiads-xyz.firebaseapp.com',
  databaseURL:
    process.env.GATSBY_FIREBASE_DATABASE_URL ??
    'https://olympiads-xyz-default-rtdb.europe-west1.firebasedatabase.app/',
  projectId: process.env.GATSBY_FIREBASE_PROJECT_ID ?? 'olympiads-xyz',
  storageBucket: process.env.GATSBY_FIREBASE_STORAGE_BUCKET ?? 'olympiads-xyz.appspot.com',
  messagingSenderId: process.env.GATSBY_FIREBASE_MESSAGING_SENDER_ID ?? '1077817845669',
  appId: process.env.GATSBY_FIREBASE_APP_ID ?? '1:1077817845669:web:443e3912b682908df12a4c',
  measurementId: process.env.GATSBY_FIREBASE_MEASUREMENT_ID ?? 'G-PK3S0MFEFQ'
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

export default app;