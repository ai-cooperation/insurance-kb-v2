/**
 * Insurance KB v3 升級 — Member 遷移腳本
 *
 * v3 把 member 預設權限從「含 view_wiki」縮減為「只看卡片」。
 * 為避免既有用戶失去現有功能，跑此腳本給所有現存 member 補
 * features override：
 *   { view_wiki: true }
 *
 * 預設 dry-run 模式 — 列出受影響清單但不寫 Firestore。
 * 確認清單後加 --apply 才實際執行。
 *
 * 用法：
 *   npx tsx scripts/migrate-existing-members-to-v3.ts            # dry-run
 *   npx tsx scripts/migrate-existing-members-to-v3.ts --apply    # 實際寫入
 *
 * 前置：
 *   - 從 cooperation-hub-bfe79 Firebase Console 下載 service account JSON
 *   - 設環境變數 GOOGLE_APPLICATION_CREDENTIALS=path/to/sa.json
 *   - 或：將 sa.json 放在 ~/.config/cooperation-hub/sa.json (gitignored)
 *
 * 安全：
 *   - 不會新增 / 刪除文件，只會 set features.view_wiki = true (idempotent)
 *   - 已有 view_wiki: false 顯式設定的用戶會被跳過（admin 主動禁掉，要保留）
 *   - vip 用戶會被跳過（他們有 '*' 通殺，無需 override）
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'insurance-kb';
const HUB_PROJECT = 'cooperation-hub-bfe79';

interface MembershipDoc {
  tier?: 'guest' | 'member' | 'vip';
  features?: Record<string, boolean>;
  expiresAt?: number;
}

function initAdmin(): void {
  if (getApps().length > 0) return;
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath) {
    initializeApp({ credential: cert(credPath), projectId: HUB_PROJECT });
  } else {
    initializeApp({ projectId: HUB_PROJECT });
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  initAdmin();
  const db = getFirestore();

  console.log(`[migrate] mode=${apply ? 'APPLY' : 'DRY-RUN'}  project=${PROJECT_ID}\n`);

  const usersSnap = await db.collection('users').get();
  const candidates: Array<{ uid: string; email?: string; tier: string; reason: string }> = [];
  const skipped: Array<{ uid: string; reason: string }> = [];

  for (const userDoc of usersSnap.docs) {
    const memberRef = userDoc.ref.collection('memberships').doc(PROJECT_ID);
    const memberSnap = await memberRef.get();

    if (!memberSnap.exists) {
      skipped.push({ uid: userDoc.id, reason: 'no-membership' });
      continue;
    }

    const m = memberSnap.data() as MembershipDoc;
    const tier = m.tier ?? 'member';

    if (tier === 'vip') {
      skipped.push({ uid: userDoc.id, reason: 'vip-has-wildcard' });
      continue;
    }

    if (m.features?.view_wiki === false) {
      skipped.push({ uid: userDoc.id, reason: 'admin-explicitly-revoked' });
      continue;
    }

    if (m.features?.view_wiki === true) {
      skipped.push({ uid: userDoc.id, reason: 'already-has-view_wiki-override' });
      continue;
    }

    const userData = userDoc.data();
    candidates.push({
      uid: userDoc.id,
      email: userData?.email,
      tier,
      reason: 'needs-view_wiki-override-to-preserve-existing-access',
    });
  }

  console.log(`Total users scanned: ${usersSnap.size}`);
  console.log(`Skipped: ${skipped.length}`);
  console.log(`To migrate: ${candidates.length}\n`);

  if (candidates.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  console.log('Migration candidates:');
  for (const c of candidates) {
    console.log(`  - ${c.uid}  (${c.email ?? 'no-email'})  tier=${c.tier}`);
  }

  if (!apply) {
    console.log('\n[DRY-RUN] No writes performed. Run with --apply to execute.');
    return;
  }

  console.log('\n[APPLY] Writing features.view_wiki=true overrides...');
  const batch = db.batch();
  for (const c of candidates) {
    const ref = db.collection('users').doc(c.uid).collection('memberships').doc(PROJECT_ID);
    batch.set(
      ref,
      { features: { view_wiki: true }, updatedAt: Date.now(), migratedFromV2: true },
      { merge: true },
    );
  }
  await batch.commit();
  console.log(`✓ Migrated ${candidates.length} memberships.`);
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
