import { initHubFirebase } from '@cooperation-hub/membership';

const env = (import.meta as any).env;

export const hub = initHubFirebase({
  apiKey: env.VITE_FB_API_KEY,
  authDomain: 'cooperation-hub-bfe79.firebaseapp.com',
  projectId: 'cooperation-hub-bfe79',
  appId: env.VITE_FB_APP_ID,
});

export const { auth, db } = hub;
export const PROJECT_ID = 'insurance-kb';
