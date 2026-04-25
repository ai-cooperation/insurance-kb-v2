import type { Timestamp } from 'firebase/firestore';

export const FLAG_THRESHOLDS = {
  multiCountry24h: 2,
  manyIps7d: 5,
  manyDevices7d: 3,
  concurrentSessions: 3,
  concurrentWindowMs: 30 * 60 * 1000,
  impossibleTravelWindowMs: 60 * 60 * 1000,
};

export interface FlagInput {
  ip: string;
  ipCountry?: string;
  deviceFingerprint: string;
  lastSeenAt: Timestamp;
  revoked: boolean;
}

export interface FlagResult {
  flags: string[];
  uniqueIps7d: number;
  uniqueCountries7d: number;
  uniqueDevices7d: number;
}

export function computeFlags(rows: FlagInput[]): FlagResult {
  const now = Date.now();
  const d1 = now - 24 * 60 * 60 * 1000;
  const m30 = now - FLAG_THRESHOLDS.concurrentWindowMs;

  const flags = new Set<string>();

  const ips7d = new Set<string>();
  const countries7d = new Set<string>();
  const devices7d = new Set<string>();
  rows.forEach(r => {
    if (r.ip) ips7d.add(r.ip);
    if (r.ipCountry) countries7d.add(r.ipCountry);
    if (r.deviceFingerprint) devices7d.add(r.deviceFingerprint);
  });

  const countries24h = new Set(
    rows
      .filter(r => r.lastSeenAt.toMillis() >= d1)
      .map(r => r.ipCountry)
      .filter((c): c is string => Boolean(c)),
  );
  if (countries24h.size >= FLAG_THRESHOLDS.multiCountry24h) {
    flags.add('multi_country_24h');
  }

  if (ips7d.size >= FLAG_THRESHOLDS.manyIps7d) flags.add('many_ips_7d');
  if (devices7d.size >= FLAG_THRESHOLDS.manyDevices7d) flags.add('many_devices_7d');

  const active = rows.filter(r => r.lastSeenAt.toMillis() >= m30 && !r.revoked);
  const activeFingerprints = new Set(active.map(r => r.deviceFingerprint));
  if (activeFingerprints.size >= FLAG_THRESHOLDS.concurrentSessions) {
    flags.add('concurrent_sessions');
  }

  const withCountry = rows
    .filter(r => r.ipCountry)
    .sort((a, b) => b.lastSeenAt.toMillis() - a.lastSeenAt.toMillis())
    .slice(0, 20);
  for (let i = 1; i < withCountry.length; i++) {
    const deltaMs =
      withCountry[i - 1].lastSeenAt.toMillis() - withCountry[i].lastSeenAt.toMillis();
    if (
      deltaMs < FLAG_THRESHOLDS.impossibleTravelWindowMs &&
      withCountry[i - 1].ipCountry !== withCountry[i].ipCountry
    ) {
      flags.add('impossible_travel');
      break;
    }
  }

  return {
    flags: Array.from(flags),
    uniqueIps7d: ips7d.size,
    uniqueCountries7d: countries7d.size,
    uniqueDevices7d: devices7d.size,
  };
}
