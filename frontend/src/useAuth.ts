/**
 * Auth hook — directly adapted from hematology-kb's proven useMembership.
 * Uses @cooperation-hub/membership (Firebase v10 modular + popup).
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import type { User } from 'firebase/auth';
import {
  onAuthStateChanged,
  signInWithGoogle,
  signOut,
  startSessionTracking,
  subscribeToUser,
  subscribeToProject,
  getEffectiveTier,
  type ProjectDoc,
  type UserDoc,
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
  const [project, setProject] = useState<ProjectDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const featuresRef = useRef<Set<string>>(new Set());

  // Subscribe to project doc + auth state
  useEffect(() => {
    const unsubProject = subscribeToProject(db, PROJECT_ID, setProject);
    const unsubAuth = onAuthStateChanged(auth, setFbUser);
    return () => { unsubProject(); unsubAuth(); };
  }, []);

  // Subscribe to user doc + session tracking
  useEffect(() => {
    if (!fbUser) { setUserDoc(null); setLoading(false); return; }
    setLoading(true);
    const unsub = subscribeToUser(db, fbUser.uid, (u) => {
      setUserDoc(u);
      setLoading(false);
    });
    let stopTracking: (() => void) | null = null;
    startSessionTracking(db, fbUser.uid, PROJECT_ID, async () => {
      await signOut(auth);
      window.location.reload();
    }).then(fn => { stopTracking = fn; });
    return () => { unsub(); if (stopTracking) stopTracking(); };
  }, [fbUser]);

  // Tier policy (same as hematology-kb):
  //   !user                    → 'guest'
  //   user + membership doc    → getEffectiveTier(membership)
  //   user + no membership     → 'member' (auto-promote on sign-in)
  const rawMembership = userDoc?.memberships?.[PROJECT_ID];
  let tier: Tier;
  if (!fbUser) {
    tier = 'guest';
  } else if (rawMembership) {
    tier = getEffectiveTier(rawMembership);
  } else {
    tier = 'member';
  }

  // Features from project.tiers[tier] + user overrides
  const baseFeatures = project?.tiers[tier]?.features ?? [];
  const features = new Set<string>(baseFeatures);
  if (fbUser && rawMembership?.features) {
    for (const [k, v] of Object.entries(rawMembership.features)) {
      if (v) features.add(k); else features.delete(k);
    }
  }
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
    await signInWithGoogle(auth, db);
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
      const currentUser = auth.currentUser;
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
