import { initHubFirebase } from '@cooperation-hub/membership';

export const hub = initHubFirebase({
  apiKey: 'AIzaSyCgCdmBYX-XYM9LmOA9Mk9M-WdxzLDS2QI',
  authDomain: 'cooperation-hub-bfe79.firebaseapp.com',
  projectId: 'cooperation-hub-bfe79',
  appId: '1:875529451396:web:246e7063e9b10034954fd1',
});

export const { auth, db } = hub;
export const PROJECT_ID = 'insurance-kb';
