/**
 * 偵測 embedded webview（LINE / Facebook / Instagram / WeChat ...）。
 * Google 自 2021 起封鎖這些環境的 OAuth 登入，必須引導用戶開外部瀏覽器。
 */

export type EmbeddedBrowserKind =
  | 'line'
  | 'facebook'
  | 'instagram'
  | 'wechat'
  | 'twitter'
  | 'linkedin'
  | 'generic'
  | null;

/**
 * 回傳 embedded browser 類型；非 embedded 回 null。
 */
export function detectEmbeddedBrowser(): EmbeddedBrowserKind {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent;

  if (/Line\//i.test(ua)) return 'line';
  if (/\bFBAN\b|\bFBAV\b|FB_IAB/i.test(ua)) return 'facebook';
  if (/Instagram/i.test(ua)) return 'instagram';
  if (/MicroMessenger/i.test(ua)) return 'wechat';
  if (/TwitterAndroid|Twitter for iPhone/i.test(ua)) return 'twitter';
  if (/LinkedInApp/i.test(ua)) return 'linkedin';

  // iOS WebView without Safari version string → 通常是 embedded
  if (/iPhone|iPad|iPod/i.test(ua) && !/Safari/i.test(ua) && /AppleWebKit/i.test(ua)) {
    return 'generic';
  }
  // Android WebView → wv token
  if (/Android.*wv\)/i.test(ua)) {
    return 'generic';
  }

  return null;
}

/**
 * 產生「用外部瀏覽器打開」的 URL。
 * - LINE：加 `openExternalBrowser=1` 參數，點擊會跳出 LINE 用 Safari/Chrome 打開
 * - 其他：直接回原網址（需用戶手動複製或點 "開啟瀏覽器" 選單）
 */
export function getExternalBrowserUrl(currentUrl: string = window.location.href): string {
  const kind = detectEmbeddedBrowser();
  if (kind !== 'line') return currentUrl;

  try {
    const url = new URL(currentUrl);
    url.searchParams.set('openExternalBrowser', '1');
    return url.toString();
  } catch {
    const sep = currentUrl.includes('?') ? '&' : '?';
    return `${currentUrl}${sep}openExternalBrowser=1`;
  }
}

/** 人類可讀的瀏覽器名稱（用於 UI 文案）。 */
export function embeddedBrowserLabel(kind: EmbeddedBrowserKind): string {
  switch (kind) {
    case 'line': return 'LINE';
    case 'facebook': return 'Facebook';
    case 'instagram': return 'Instagram';
    case 'wechat': return 'WeChat';
    case 'twitter': return 'Twitter / X';
    case 'linkedin': return 'LinkedIn';
    case 'generic': return '內嵌瀏覽器';
    default: return '';
  }
}
