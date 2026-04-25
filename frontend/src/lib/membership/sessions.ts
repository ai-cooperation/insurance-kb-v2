import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
  type Firestore,
} from 'firebase/firestore';
import { buildDeviceFingerprint, detectBrowser, detectPlatform, getTimezone } from './fingerprint.js';
import { computeFlags, type FlagInput } from './flags.js';

const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;

interface IpLookup {
  ip: string;
  country?: string;
  city?: string;
}

async function lookupIp(): Promise<IpLookup> {
  try {
    const res = await fetch('https://ipapi.co/json/', {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return { ip: 'unknown' };
    const data = (await res.json()) as {
      ip?: string;
      country_name?: string;
      city?: string;
    };
    return {
      ip: data.ip ?? 'unknown',
      country: data.country_name,
      city: data.city,
    };
  } catch {
    return { ip: 'unknown' };
  }
}

/**
 * Start session tracking for the current tab.
 * - Creates /users/{uid}/sessions/{sessionId} on first call
 * - Updates lastSeenAt every 5 min when tab visible, and on visibility change
 * - Re-reads the session doc each heartbeat — if admin set revoked=true,
 *   invokes onRevoked() and stops
 *
 * Returns stop() to call on sign-out.
 */
export async function startSessionTracking(
  db: Firestore,
  uid: string,
  projectId: string,
  onRevoked?: () => void | Promise<void>,
): Promise<() => void> {
  const deviceFingerprint = await buildDeviceFingerprint();
  const platform = detectPlatform();
  const browser = detectBrowser();
  const timezone = getTimezone();
  const userAgent = navigator.userAgent;

  const sessionsCol = collection(db, 'users', uid, 'sessions');
  const sessionRef = doc(sessionsCol);  // generate new id
  let sessionId = sessionRef.id;

  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function writeSession(isFirst: boolean) {
    if (stopped) return;
    const { ip, country, city } = await lookupIp();
    const now = serverTimestamp();

    const data: Record<string, unknown> = {
      uid,
      projectId,
      lastSeenAt: now,
      ip,
      userAgent,
      platform,
      browser,
      deviceFingerprint,
      timezone,
    };
    if (country) data.ipCountry = country;
    if (city) data.ipCity = city;
    if (isFirst) {
      data.createdAt = now;
      data.revoked = false;
    }

    await setDoc(doc(sessionsCol, sessionId), data, { merge: true });

    // Check if admin revoked us
    const snap = await getDoc(doc(sessionsCol, sessionId));
    if (snap.exists() && snap.data().revoked === true) {
      stopped = true;
      if (timer) clearInterval(timer);
      if (onRevoked) await onRevoked();
      return;
    }

    // Recompute flags and write summary
    await recomputeSummary(db, uid);
  }

  async function recomputeSummary(db: Firestore, uid: string) {
    const sevenDaysAgo = Timestamp.fromMillis(
      Date.now() - 7 * 24 * 60 * 60 * 1000,
    );
    const q = query(
      collection(db, 'users', uid, 'sessions'),
      where('lastSeenAt', '>=', sevenDaysAgo),
    );
    const snap = await getDocs(q);
    const rows: FlagInput[] = snap.docs
      .map(d => d.data())
      .filter(d => d.lastSeenAt)  // skip docs still being written
      .map(d => ({
        ip: d.ip as string,
        ipCountry: d.ipCountry as string | undefined,
        deviceFingerprint: d.deviceFingerprint as string,
        lastSeenAt: d.lastSeenAt as Timestamp,
        revoked: Boolean(d.revoked),
      }));
    const result = computeFlags(rows);

    const current = rows.find(r => r.ip); // representative
    await setDoc(
      doc(db, 'users', uid),
      {
        lastLoginAt: serverTimestamp(),
        sessionSummary: {
          lastLoginAt: serverTimestamp(),
          lastIp: current?.ip ?? 'unknown',
          ...(current?.ipCountry ? { lastIpCountry: current.ipCountry } : {}),
          lastDeviceFingerprint: deviceFingerprint,
          uniqueIps7d: result.uniqueIps7d,
          uniqueCountries7d: result.uniqueCountries7d,
          uniqueDevices7d: result.uniqueDevices7d,
          flags: result.flags,
        },
      },
      { merge: true },
    );
  }

  // Initial write
  await writeSession(true);

  // Periodic heartbeat
  timer = setInterval(() => {
    if (document.visibilityState === 'visible') writeSession(false);
  }, HEARTBEAT_INTERVAL_MS);

  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') writeSession(false);
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}
