import { initHubFirebase } from './membership';

// =============================================================================
// ⚠️  DO NOT replace these values with import.meta.env.VITE_FB_*
// =============================================================================
// frontend/.env is gitignored. CI runners (GitHub Actions) have no .env
// when running `vite build`, so import.meta.env.VITE_FB_API_KEY etc.
// resolve to `undefined`. The deployed bundle then calls
// initializeApp({ apiKey: undefined, ... }) which throws synchronously,
// React never mounts, and users see a blank white page.
//
// This has been burned TWICE already:
//   2026-04-21 d4613c0  hardcoded these values for the first time
//   2026-04-21 de26fb1  reverted to env vars (well-meaning but wrong for CI)
//   2026-04-26          production white-screened after CI auto-deploy
//                       finally started working — env-var revert hit prod
//
// These values are PUBLIC. Firebase Web SDK config ships in the browser
// bundle by design — anyone inspecting the JS can see them. Security is
// enforced by Firestore Rules + Auth, NOT by hiding apiKey.
//
// If you really need per-environment config (e.g. staging vs prod), use
// build-arg constants or a separate file checked into git, NOT a .env.
// =============================================================================
export const hub = initHubFirebase({
  apiKey: 'AIzaSyCgCdmBYX-XYM9LmOA9Mk9M-WdxzLDS2QI',
  authDomain: 'cooperation-hub-bfe79.firebaseapp.com',
  projectId: 'cooperation-hub-bfe79',
  appId: '1:875529451396:web:246e7063e9b10034954fd1',
});

export const { auth, db } = hub;
export const PROJECT_ID = 'insurance-kb';
