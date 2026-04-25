/**
 * Build a lightweight device fingerprint from UA + screen + timezone.
 * This is not cryptographic — just enough to detect "obviously different device".
 */
export async function buildDeviceFingerprint(): Promise<string> {
  const parts = [
    navigator.userAgent,
    navigator.platform,
    `${screen.width}x${screen.height}`,
    `${screen.colorDepth}`,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    navigator.language,
    navigator.hardwareConcurrency ?? 0,
  ].join('|');

  const bytes = new TextEncoder().encode(parts);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .slice(0, 16)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export function detectPlatform(): string {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
  if (/Android/i.test(ua)) return 'Android';
  if (/Mac/i.test(ua)) return 'macOS';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Unknown';
}

export function detectBrowser(): string {
  const ua = navigator.userAgent;
  const match = (re: RegExp) => ua.match(re)?.[1];
  const edge = match(/Edg\/(\d+)/);
  if (edge) return `Edge ${edge}`;
  const chrome = match(/Chrome\/(\d+)/);
  if (chrome && !/Edg\//.test(ua)) return `Chrome ${chrome}`;
  const firefox = match(/Firefox\/(\d+)/);
  if (firefox) return `Firefox ${firefox}`;
  const safari = match(/Version\/(\d+).*Safari/);
  if (safari) return `Safari ${safari}`;
  return 'Unknown';
}

export function getTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
}
