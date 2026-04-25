import { initializeApp, getApps, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

export interface HubFirebase {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
}

/**
 * Initialize (or reuse) a Firebase app pointing at cooperation-hub.
 * Safe to call multiple times — the underlying FirebaseApp is singleton.
 */
export function initHubFirebase(config: FirebaseOptions): HubFirebase {
  const existing = getApps().find(a => a.options.projectId === config.projectId);
  const app = existing ?? initializeApp(config);
  return {
    app,
    auth: getAuth(app),
    db: getFirestore(app),
  };
}
