/**
 * Auth hook using Firebase v8 compat (global firebase object).
 * Same approach as iPAS — proven to work on mobile.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Tier } from './types';

const PROJECT_ID = 'insurance-kb';
const API_BASE = 'https://insurance-kb-api.alan-chen75.workers.dev';

// Global firebase object loaded via script tags in index.html
declare const firebase: any;

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

function getEffectiveTier(m: any): Tier {
  if (!m) return 'guest';
  if (m.tier !== 'vip') return m.tier;
  if (m.expiresAt && m.expiresAt.toMillis() < Date.now()) return 'member';
  return 'vip';
}

function getUserFeatures(m: any, p: any): Set<string> {
  const tier = getEffectiveTier(m);
  const base = p?.tiers?.[tier]?.features ?? [];
  const features = new Set<string>(base);
  if (m?.features) {
    for (const [key, enabled] of Object.entries(m.features)) {
      if (enabled) features.add(key); else features.delete(key as string);
    }
  }
  return features;
}

export function useAuth(): AuthStore {
  const [fbUser, setFbUser] = useState<any>(null);
  const [userDoc, setUserDoc] = useState<any>(null);
  const [projectDoc, setProjectDoc] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const featuresRef = useRef<Set<string>>(new Set());

  // Listen to auth state
  useEffect(() => {
    if (typeof firebase === 'undefined') {
      setLoading(false);
      return;
    }

    // Handle redirect result (mobile login)
    firebase.auth().getRedirectResult().then((result: any) => {
      if (result?.user) {
        ensureUserAndMember(result.user);
      }
    }).catch(() => {});

    const unsub = firebase.auth().onAuthStateChanged((user: any) => {
      setFbUser(user);
      if (!user) {
        setUserDoc(null);
        setProjectDoc(null);
        setLoading(false);
      }
    });
    return () => unsub();
  }, []);

  // Subscribe to Firestore docs
  useEffect(() => {
    if (!fbUser) return;
    const db = firebase.firestore();
    const unsubs: Array<() => void> = [];

    unsubs.push(
      db.doc(`users/${fbUser.uid}`).onSnapshot((snap: any) => {
        setUserDoc(snap.exists ? snap.data() : null);
        setLoading(false);
      })
    );

    unsubs.push(
      db.doc(`projects/${PROJECT_ID}`).onSnapshot((snap: any) => {
        setProjectDoc(snap.exists ? snap.data() : null);
      })
    );

    return () => unsubs.forEach(fn => fn());
  }, [fbUser]);

  // Compute tier and features
  const membership = userDoc?.memberships?.[PROJECT_ID];
  const tier: Tier = getEffectiveTier(membership);
  const features = projectDoc ? getUserFeatures(membership, projectDoc) : new Set<string>();
  featuresRef.current = features;

  const user: AuthUser | null = fbUser
    ? {
        email: fbUser.email || '',
        name: fbUser.displayName || fbUser.email?.split('@')[0] || '',
        picture: fbUser.photoURL || '',
        tier,
      }
    : null;

  const login = useCallback(async () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    // Same pattern as iPAS: try popup, fallback to redirect
    try {
      const result = await firebase.auth().signInWithPopup(provider);
      await ensureUserAndMember(result.user);
    } catch (e: any) {
      if (e.code === 'auth/popup-blocked' || e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') {
        firebase.auth().signInWithRedirect(provider);
      } else {
        console.error('Login failed:', e.code, e.message);
      }
    }
  }, []);

  const logout = useCallback(async () => {
    await firebase.auth().signOut();
  }, []);

  const hasFeature = useCallback(
    (key: string) => featuresRef.current.has('*') || featuresRef.current.has(key),
    [],
  );

  const apiFetch = useCallback(
    async (path: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const currentUser = firebase.auth().currentUser;
      if (currentUser) {
        const token = await currentUser.getIdToken();
        headers.set('Authorization', `Bearer ${token}`);
      }
      return fetch(`${API_BASE}${path}`, { ...init, headers });
    },
    [],
  );

  return { user, loading, login, logout, tier, hasFeature, apiFetch };
}

async function ensureUserAndMember(user: any): Promise<void> {
  const db = firebase.firestore();
  const userRef = db.doc(`users/${user.uid}`);
  const snap = await userRef.get();

  if (!snap.exists) {
    await userRef.set({
      email: user.email,
      displayName: user.displayName ?? '',
      photoURL: user.photoURL ?? null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      lastLoginAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  } else {
    await userRef.update({ lastLoginAt: firebase.firestore.FieldValue.serverTimestamp() });
  }

  // Auto-grant member
  const data = snap.exists ? snap.data() : {};
  if (!data?.memberships?.[PROJECT_ID]) {
    await userRef.set({
      memberships: {
        ...data?.memberships,
        [PROJECT_ID]: {
          tier: 'member',
          grantedAt: firebase.firestore.FieldValue.serverTimestamp(),
          grantedBy: 'auto:first-login',
          expiresAt: null,
          paymentRef: 'auto',
        },
      },
    }, { merge: true });
  }
}
