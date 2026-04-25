import type { Timestamp } from 'firebase/firestore';

export type Tier = 'guest' | 'member' | 'vip';
export type VipKind = 'lifetime' | 'subscription' | null;

export interface Membership {
  tier: Tier;
  grantedAt: Timestamp;
  expiresAt: Timestamp | null;
  paymentRef: string;
  grantedBy: string;
  subscriptionStatus?: 'active' | 'cancelled' | 'past_due' | 'trialing';
  autoRenew?: boolean;
  features?: Record<string, boolean>;
}

export interface SessionSummary {
  lastLoginAt: Timestamp;
  lastIp: string;
  lastIpCountry?: string;
  lastDeviceFingerprint: string;
  uniqueIps7d: number;
  uniqueCountries7d: number;
  uniqueDevices7d: number;
  flags: string[];
}

export interface UserDoc {
  email: string;
  displayName: string;
  photoURL?: string;
  createdAt: Timestamp;
  lastLoginAt: Timestamp;
  memberships?: Record<string, Membership>;
  sessionSummary?: SessionSummary;
}

export interface TierConfig {
  features: string[];
}

export interface FeatureMeta {
  label: string;
  description?: string;
}

export interface ProjectDoc {
  name: string;
  defaultTier: Tier;   // tier applied to logged-in users with no explicit membership
  tiers: Record<Tier, TierConfig>;
  featureCatalog: Record<string, FeatureMeta>;
  active: boolean;
}

export interface SessionDoc {
  uid: string;
  projectId: string;
  createdAt: Timestamp;
  lastSeenAt: Timestamp;
  ip: string;
  ipCountry?: string;
  ipCity?: string;
  userAgent: string;
  platform: string;
  browser: string;
  deviceFingerprint: string;
  timezone: string;
  revoked: boolean;
  revokedAt?: Timestamp;
  revokedBy?: string;
}

export interface PreGrantDoc {
  email: string;                               // original email (doc id == email)
  memberships: Record<string, PreGrantEntry>;  // by projectId
  createdAt: Timestamp;
  createdBy: string;                           // "admin:email"
  claimedAt: Timestamp | null;
  claimedByUid: string | null;
}

export interface PreGrantEntry {
  tier: Tier;
  expiresAt: Timestamp | null;
  paymentRef: string;
  reason: string;
}

export type AuditAction = 'grant' | 'revoke' | 'upgrade' | 'renew' | 'expire' | 'pregrant_claim';

export interface AuditDoc {
  userId: string;
  projectId: string;
  action: AuditAction;
  fromTier: Tier | null;
  toTier: Tier;
  operatedBy: string;
  reason?: string;
  timestamp: Timestamp;
}
