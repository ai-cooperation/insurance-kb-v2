import { doc, onSnapshot, type Firestore, type Unsubscribe } from 'firebase/firestore';
import type { Membership, ProjectDoc, Tier, UserDoc, VipKind } from './types.js';

/**
 * Decide the user's effective tier for a given project.
 *
 * Rules:
 * - No membership entry → `project.defaultTier` if provided (usually 'member' for logged-in
 *   users), otherwise 'guest' (typical for non-logged-in).
 * - Explicit membership with tier != 'vip' → that tier (admin can explicitly set 'guest' to ban).
 * - VIP with expired `expiresAt` → auto-downgrade to 'member' for display (data unchanged).
 * - VIP not expired or lifetime → 'vip'.
 *
 * Pass `project` to make defaultTier take effect. Without it we fall back to 'guest'.
 */
export function getEffectiveTier(
  membership: Membership | undefined,
  project?: ProjectDoc,
): Tier {
  if (!membership) return project?.defaultTier ?? 'guest';
  if (membership.tier !== 'vip') return membership.tier;

  if (membership.expiresAt) {
    const expiry = membership.expiresAt.toMillis();
    if (expiry < Date.now()) return 'member';
  }
  return 'vip';
}

export function getVipKind(membership: Membership | undefined): VipKind {
  if (membership?.tier !== 'vip') return null;
  return membership.expiresAt === null ? 'lifetime' : 'subscription';
}

/**
 * Compute the set of feature keys this user has for a project.
 * Applies per-user overrides on top of tier defaults.
 */
export function getUserFeatures(
  membership: Membership | undefined,
  project: ProjectDoc,
): Set<string> {
  const tier = getEffectiveTier(membership, project);
  const base = project.tiers[tier]?.features ?? [];
  const features = new Set<string>(base);

  if (membership?.features) {
    for (const [key, enabled] of Object.entries(membership.features)) {
      if (enabled) features.add(key);
      else features.delete(key);
    }
  }

  return features;
}

export function canAccess(userFeatures: Set<string>, required: string[]): boolean {
  if (userFeatures.has('*')) return true;
  if (required.length === 0) return true;
  return required.every(f => userFeatures.has(f));
}

/**
 * Subscribe to a user's doc. Returns the unsubscribe function.
 */
export function subscribeToUser(
  db: Firestore,
  uid: string,
  cb: (user: UserDoc | null) => void,
): Unsubscribe {
  const ref = doc(db, 'users', uid);
  return onSnapshot(ref, snap => {
    cb(snap.exists() ? (snap.data() as UserDoc) : null);
  });
}

/**
 * Subscribe to a project doc. Returns the unsubscribe function.
 */
export function subscribeToProject(
  db: Firestore,
  projectId: string,
  cb: (project: ProjectDoc | null) => void,
): Unsubscribe {
  const ref = doc(db, 'projects', projectId);
  return onSnapshot(ref, snap => {
    cb(snap.exists() ? (snap.data() as ProjectDoc) : null);
  });
}
