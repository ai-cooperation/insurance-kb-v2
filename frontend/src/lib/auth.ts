export type UserLevel = 'guest' | 'member' | 'vip'

export async function getUserLevel(): Promise<UserLevel> {
  try {
    const resp = await fetch('/api/search?q=test')
    if (!resp.ok) return 'guest'
    const vipResp = await fetch('/api/chat/status')
    if (vipResp.status === 403) return 'member'
    return 'vip'
  } catch {
    return 'guest'
  }
}

export function canAccess(required: UserLevel, current: UserLevel): boolean {
  const levels: Record<UserLevel, number> = {
    guest: 0,
    member: 1,
    vip: 2,
  }
  return levels[current] >= levels[required]
}

export function getLevelLabel(level: UserLevel): string {
  const labels: Record<UserLevel, string> = {
    guest: '訪客',
    member: '會員',
    vip: 'VIP',
  }
  return labels[level]
}
