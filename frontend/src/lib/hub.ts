import { initHubFirebase } from './membership';

const env = import.meta.env;

export const hub = initHubFirebase({
  apiKey: env.VITE_FB_API_KEY,
  authDomain: env.VITE_FB_AUTH_DOMAIN,
  projectId: env.VITE_FB_PROJECT_ID,
  appId: env.VITE_FB_APP_ID,
});

export const { auth, db } = hub;
export const PROJECT_ID = 'insurance-kb';
