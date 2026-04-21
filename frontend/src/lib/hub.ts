import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const app = initializeApp({
  apiKey: 'AIzaSyCgCdmBYX-XYM9LmOA9Mk9M-WdxzLDS2QI',
  authDomain: 'cooperation-hub-bfe79.firebaseapp.com',
  projectId: 'cooperation-hub-bfe79',
  appId: '1:875529451396:web:246e7063e9b10034954fd1',
});

export const auth = getAuth(app);
export const db = getFirestore(app);
export const PROJECT_ID = 'insurance-kb';
