import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import type { PreGrantDoc, PreGrantEntry, Tier } from './types.js';

/**
 * Read /admin/config to check if the current user's email is in the admins list.
 * Rules allow only admins to read this doc (self-referential — only works if you ARE admin).
 */
export async function checkIsAdmin(
  db: Firestore,
  _currentUid: string,
  currentEmail: string | null,
): Promise<{ isAdmin: boolean; email: string | null }> {
  try {
    const snap = await getDoc(doc(db, 'admin', 'config'));
    if (!snap.exists()) return { isAdmin: false, email: currentEmail };
    const admins: string[] = snap.data().admins ?? [];
    return { isAdmin: admins.includes(currentEmail ?? ''), email: currentEmail };
  } catch {
    // PERMISSION_DENIED → not an admin
    return { isAdmin: false, email: currentEmail };
  }
}

export interface GrantOptions {
  targetUid: string;
  projectId: string;
  tier: Tier;
  lifetime?: boolean;
  days?: number;
  paymentRef?: string;
  reason?: string;
  operatorEmail: string;
}

/**
 * Admin-only: grant/update a membership AND write an audit entry.
 * Both writes happen in a batch so they succeed or fail together.
 */
export async function grantMembership(
  db: Firestore,
  opts: GrantOptions,
): Promise<void> {
  const { targetUid, projectId, tier, lifetime, days, paymentRef, reason, operatorEmail } = opts;

  const userRef = doc(db, 'users', targetUid);
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) throw new Error('user not found');

  const existing = userSnap.data()?.memberships?.[projectId];
  const fromTier: Tier | null = existing?.tier ?? null;

  const now = Timestamp.now();
  const expiresAt =
    tier === 'vip' && lifetime
      ? null
      : Timestamp.fromMillis(Date.now() + (days ?? 365) * 24 * 60 * 60 * 1000);

  const operatedBy = `admin:${operatorEmail}`;

  const batch = writeBatch(db);
  batch.set(
    userRef,
    {
      memberships: {
        [projectId]: {
          tier,
          grantedAt: now,
          expiresAt,
          paymentRef: paymentRef ?? 'manual',
          grantedBy: operatedBy,
        },
      },
    },
    { merge: true },
  );

  const auditRef = doc(collection(db, 'audit'));
  batch.set(auditRef, {
    userId: targetUid,
    projectId,
    action: fromTier === null ? 'grant' : fromTier === tier ? 'renew' : 'upgrade',
    fromTier,
    toTier: tier,
    operatedBy,
    reason: reason ?? 'admin UI',
    timestamp: now,
  });

  await batch.commit();
}

export async function revokeMembership(
  db: Firestore,
  opts: {
    targetUid: string;
    projectId: string;
    reason?: string;
    operatorEmail: string;
  },
): Promise<void> {
  const { targetUid, projectId, reason, operatorEmail } = opts;
  const userRef = doc(db, 'users', targetUid);
  const userSnap = await getDoc(userRef);
  const existing = userSnap.data()?.memberships?.[projectId];
  if (!existing) throw new Error('no such membership');

  const batch = writeBatch(db);
  batch.update(userRef, {
    [`memberships.${projectId}`]: deleteField(),
  });
  const auditRef = doc(collection(db, 'audit'));
  batch.set(auditRef, {
    userId: targetUid,
    projectId,
    action: 'revoke',
    fromTier: existing.tier,
    toTier: 'guest',
    operatedBy: `admin:${operatorEmail}`,
    reason: reason ?? 'admin UI',
    timestamp: Timestamp.now(),
  });
  await batch.commit();
}

/**
 * Admin-only: set revoked=true on one or all of a user's sessions.
 * Returns count of revoked sessions.
 */
// ---------- preGrant helpers (admin-only) ----------

export interface CreatePreGrantOptions {
  email: string;
  projectId: string;
  tier: Tier;
  lifetime?: boolean;
  days?: number;
  paymentRef?: string;
  reason?: string;
  operatorEmail: string;
}

/**
 * Admin-only: 建立或更新 preGrant — 在用戶登入前預先綁定 email → tier。
 * 對方首次登入時會自動被 `claimPreGrantIfAny` 領取。
 */
export async function createPreGrant(
  db: Firestore,
  opts: CreatePreGrantOptions,
): Promise<void> {
  const { email, projectId, tier, lifetime, days, paymentRef, reason, operatorEmail } = opts;

  const ref = doc(db, 'preGrants', email);
  const snap = await getDoc(ref);
  const existing = snap.exists() ? (snap.data() as PreGrantDoc) : null;

  if (existing?.claimedByUid) {
    throw new Error(`${email} 的 preGrant 已被領取過（uid=${existing.claimedByUid}），請用 grant 直接改該用戶`);
  }

  const expiresAt: Timestamp | null =
    tier === 'vip' && lifetime
      ? null
      : Timestamp.fromMillis(Date.now() + (days ?? 365) * 24 * 60 * 60 * 1000);

  const entry: PreGrantEntry = {
    tier,
    expiresAt,
    paymentRef: paymentRef ?? 'manual',
    reason: reason ?? 'pre-grant',
  };

  const now = Timestamp.now();
  const merged: PreGrantDoc = {
    email,
    memberships: {
      ...(existing?.memberships ?? {}),
      [projectId]: entry,
    },
    createdAt: existing?.createdAt ?? now,
    createdBy: existing?.createdBy ?? `admin:${operatorEmail}`,
    claimedAt: null,
    claimedByUid: null,
  };

  await setDoc(ref, merged);
}

export async function listPreGrants(db: Firestore): Promise<Array<PreGrantDoc & { id: string }>> {
  const snap = await getDocs(collection(db, 'preGrants'));
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as PreGrantDoc) }));
}

export async function deletePreGrant(db: Firestore, email: string): Promise<void> {
  await deleteDoc(doc(db, 'preGrants', email));
}

// ---------- sessions ----------

export async function revokeSessions(
  db: Firestore,
  opts: { targetUid: string; sessionId?: string; operatorEmail: string },
): Promise<number> {
  const { targetUid, sessionId, operatorEmail } = opts;
  const col = collection(db, 'users', targetUid, 'sessions');
  const operatedBy = `admin:${operatorEmail}`;
  const now = serverTimestamp();

  if (sessionId) {
    await setDoc(
      doc(col, sessionId),
      { revoked: true, revokedAt: now, revokedBy: operatedBy },
      { merge: true },
    );
    return 1;
  }

  const snap = await getDocs(query(col, where('revoked', '==', false)));
  const batch = writeBatch(db);
  snap.docs.forEach(d => {
    batch.update(d.ref, { revoked: true, revokedAt: now, revokedBy: operatedBy });
  });
  await batch.commit();
  return snap.size;
}
