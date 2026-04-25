import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut as fbSignOut,
  onAuthStateChanged,
  type Auth,
  type User,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  Timestamp,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import type { PreGrantDoc } from './types.js';

/**
 * 每次登入都確保 /users/{uid} 有最新 profile（email/displayName/photoURL/lastLoginAt）。
 * 首次登入額外設 createdAt。
 *
 * 必須 idempotent 且每次都寫 email —— 避免 race condition：startSessionTracking 可能
 * 從 onAuthStateChanged 觸發並先 merge 寫 sessionSummary，若當時該 uid 還沒 doc 就
 * 會建出「只有 sessionSummary、沒有 email」的殘缺 doc。這裡強制每次覆寫 profile 欄位。
 */
async function ensureUserDoc(user: User, db: Firestore): Promise<void> {
  const userRef = doc(db, 'users', user.uid);
  const snap = await getDoc(userRef);

  const base = {
    email: user.email,
    displayName: user.displayName ?? '',
    photoURL: user.photoURL ?? null,
    lastLoginAt: serverTimestamp(),
  };

  if (!snap.exists()) {
    await setDoc(userRef, { ...base, createdAt: serverTimestamp() });
  } else {
    await setDoc(userRef, base, { merge: true });
  }
}

/**
 * 若有 preGrant 匹配這個 email，原封把 memberships 寫進 /users/{uid}，並標記 preGrant claimed。
 * 失敗 silently（例如沒 preGrant、已被別人領過），不阻擋登入流程。
 */
async function claimPreGrantIfAny(user: User, db: Firestore): Promise<void> {
  if (!user.email) return;
  const preGrantRef = doc(db, 'preGrants', user.email);
  const snap = await getDoc(preGrantRef);
  if (!snap.exists()) return;

  const data = snap.data() as PreGrantDoc;
  if (data.claimedByUid) return;

  const userRef = doc(db, 'users', user.uid);
  const now = Timestamp.now();

  // Convert preGrant entries to canonical Membership shape (adds grantedAt/grantedBy).
  const memberships: Record<string, unknown> = {};
  for (const [projectId, entry] of Object.entries(data.memberships)) {
    memberships[projectId] = {
      tier: entry.tier,
      grantedAt: now,
      expiresAt: entry.expiresAt,
      paymentRef: entry.paymentRef,
      grantedBy: data.createdBy,
    };
  }

  const batch = writeBatch(db);
  batch.set(userRef, { memberships }, { merge: true });
  batch.update(preGrantRef, {
    claimedByUid: user.uid,
    claimedAt: now,
  });
  try {
    await batch.commit();
  } catch (err) {
    // Rules 擋或競爭失敗 — 登入仍要成功，但要讓 caller 看得見錯誤
    console.error('[membership] preGrant claim failed:', err);
  }
}

/**
 * Sign in with Google — 使用 signInWithPopup（參考 ipas 專案，桌面 + 手機實測都可用）。
 *
 * 回傳登入成功的 User，或拋錯（含 popup-closed-by-user）。
 * 登入後會自動 claim preGrant（若有）。
 */
export async function signInWithGoogle(auth: Auth, db: Firestore): Promise<User> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const result = await signInWithPopup(auth, provider);
  await ensureUserDoc(result.user, db);
  await claimPreGrantIfAny(result.user, db);
  return result.user;
}

/**
 * 舊版 redirect flow 的相容保留（目前未使用 redirect，此函式 no-op 回 null）。
 * 保留 export 避免 breaking change。
 */
export async function handleAuthRedirect(_auth: Auth, _db: Firestore): Promise<User | null> {
  return null;
}

export async function signOut(auth: Auth): Promise<void> {
  await fbSignOut(auth);
}

export { onAuthStateChanged };
