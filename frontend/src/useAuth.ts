/**
 * Auth hook backed by cooperation-hub (Firebase Auth + Firestore memberships).
 *
 * - Login via Firebase Google popup
 * - Tier read from Firestore /users/{uid}/memberships/insurance-kb
 * - Session tracking with heartbeat
 * - Feature-based access control
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  signInWithGoogle,
  signOut,
  startSessionTracking,
  subscribeToUser,
  subscribeToProject,
  getEffectiveTier,
  getUserFeatures,
  type UserDoc,
  type ProjectDoc,
  type Tier,
} from '@cooperation-hub/membership';
import { auth, db, PROJECT_ID } from './lib/hub';

const API_BASE = 'https://insurance-kb-api.alan-chen75.workers.dev';

export interface AuthUser {
  readonly email: string;
  readonly name: string;
  readonly picture: string;
  readonly tier: Tier;
}

export interface AuthStore {
  readonly user: AuthUser | null;
  readonly loading: boolean;
  readonly login: () => Promise<void>;
  readonly logout: () => Promise<void>;
  readonly tier: Tier;
  readonly hasFeature: (key: string) => boolean;
  readonly apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
}

export function useAuth(): AuthStore {
  const [fbUser, setFbUser] = useState<User | null>(null);
  const [userDoc, setUserDoc] = useState<UserDoc | null>(null);
  const [projectDoc, setProjectDoc] = useState<ProjectDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const featuresRef = useRef<Set<string>>(new Set());

  // Listen to Firebase auth state
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFbUser(user);
      if (!user) {
        setUserDoc(null);
        setProjectDoc(null);
        setLoading(false);
      }
    });
    return unsub;
  }, []);

  // When user signs in, subscribe to Firestore docs + start session tracking
  useEffect(() => {
    if (!fbUser) return;

    const unsubs: Array<() => void> = [];

    // Subscribe to user doc (realtime tier updates)
    unsubs.push(
      subscribeToUser(db, fbUser.uid, (doc) => {
        setUserDoc(doc);
        setLoading(false);
      }),
    );

    // Subscribe to project doc (feature definitions)
    unsubs.push(
      subscribeToProject(db, PROJECT_ID, (doc) => {
        setProjectDoc(doc);
      }),
    );

    // Session tracking with heartbeat
    startSessionTracking(db, fbUser.uid, PROJECT_ID, () => {
      // onRevoked: session was revoked by admin
      signOut(auth).then(() => window.location.reload());
    }).then((stop) => {
      if (stop) unsubs.push(stop);
    });

    return () => unsubs.forEach((fn) => fn());
  }, [fbUser]);

  // Compute tier and features
  const membership = userDoc?.memberships?.[PROJECT_ID];
  const tier: Tier = getEffectiveTier(membership);
  const features = projectDoc ? getUserFeatures(membership, projectDoc) : new Set<string>();

  featuresRef.current = features;

  // Build user object
  const user: AuthUser | null = fbUser
    ? {
        email: fbUser.email || '',
        name: fbUser.displayName || fbUser.email?.split('@')[0] || '',
        picture: fbUser.photoURL || '',
        tier,
      }
    : null;

  const login = useCallback(async () => {
    try {
      let user: import('firebase/auth').User;
      try {
        user = await signInWithGoogle(auth, db);
      } catch (popupErr: any) {
        // Popup blocked (mobile Safari etc) — fallback to redirect
        if (popupErr?.code === 'auth/popup-blocked' || popupErr?.code === 'auth/popup-closed-by-user') {
          const { GoogleAuthProvider, signInWithRedirect } = await import('firebase/auth');
          const provider = new GoogleAuthProvider();
          await signInWithRedirect(auth, provider);
          return;
        }
        throw popupErr;
      }
      // Auto-grant member on first login for insurance-kb
      const { doc: firestoreDoc, getDoc, setDoc, serverTimestamp } = await import('firebase/firestore');
      const userRef = firestoreDoc(db, 'users', user.uid);
      const snap = await getDoc(userRef);
      const data = snap.data();
      if (!data?.memberships?.[PROJECT_ID]) {
        await setDoc(userRef, {
          memberships: {
            ...data?.memberships,
            [PROJECT_ID]: {
              tier: 'member',
              grantedAt: serverTimestamp(),
              grantedBy: 'auto:first-login',
              expiresAt: null,
              paymentRef: 'auto',
            },
          },
        }, { merge: true });
      }
    } catch (err) {
      console.error('Login failed:', err);
    }
  }, []);

  const logout = useCallback(async () => {
    await signOut(auth);
  }, []);

  const hasFeature = useCallback(
    (key: string) => featuresRef.current.has('*') || featuresRef.current.has(key),
    [],
  );

  const apiFetch = useCallback(
    async (path: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      // Send Firebase ID token to Workers
      const token = await auth.currentUser?.getIdToken();
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
      return fetch(`${API_BASE}${path}`, { ...init, headers });
    },
    [],
  );

  return { user, loading, login, logout, tier, hasFeature, apiFetch };
}
