import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  getFirestore,
  initializeFirestore,
} from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import * as React from 'react';
import { createContext } from 'react';

export const FirebaseAppContext = createContext<FirebaseApp | null>(null);
const firebaseConfig = {
  apiKey: process.env.GATSBY_FIREBASE_API_KEY,
  authDomain: process.env.GATSBY_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.GATSBY_FIREBASE_DATABASE_URL,
  projectId: process.env.GATSBY_FIREBASE_PROJECT_ID,
  storageBucket: process.env.GATSBY_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.GATSBY_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.GATSBY_FIREBASE_APP_ID,
  measurementId: process.env.GATSBY_FIREBASE_MEASUREMENT_ID
};

export const FirebaseProvider = ({ children }) => {
  const [firebaseApp, setFirebaseApp] = React.useState<FirebaseApp | null>(
    null
  );

  React.useEffect(() => {
    if (!firebaseApp && typeof window !== 'undefined') {
      const firebaseApp =
        getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
      setFirebaseApp(firebaseApp);
      //TODO: change this to olympiads-xyz long polling
      if (localStorage.getItem('USACO_GUIDE_LONG_POLLING') === 'true') {
        // console.log('Initializing long polling');
        initializeFirestore(firebaseApp, {
          experimentalForceLongPolling: true,
        });
      }

      //TODO: do not forget to remove this
      const shouldUseEmulator = false;
      if (shouldUseEmulator) {
        connectAuthEmulator(getAuth(firebaseApp), 'http://localhost:9099');
        connectFirestoreEmulator(getFirestore(firebaseApp), 'localhost', 8080);
        connectFunctionsEmulator(getFunctions(firebaseApp), 'localhost', 5001);
      }
    }
  }, []);

  return (
    <FirebaseAppContext.Provider value={firebaseApp}>
      {children}
    </FirebaseAppContext.Provider>
  );
};
