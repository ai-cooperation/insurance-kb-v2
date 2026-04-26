import { initHubFirebase } from './membership';

// Firebase Web SDK config — these are public values that ship in the
// browser bundle anyway; security is enforced by Firestore Rules, not by
// hiding apiKey. Hardcoded so CI builds don't depend on .env secrets.
// (Reverting de26fb1 which broke CI auto-deploy.)
export const hub = initHubFirebase({
  apiKey: 'AIzaSyCgCdmBYX-XYM9LmOA9Mk9M-WdxzLDS2QI',
  authDomain: 'cooperation-hub-bfe79.firebaseapp.com',
  projectId: 'cooperation-hub-bfe79',
  appId: '1:875529451396:web:246e7063e9b10034954fd1',
});

export const { auth, db } = hub;
export const PROJECT_ID = 'insurance-kb';
