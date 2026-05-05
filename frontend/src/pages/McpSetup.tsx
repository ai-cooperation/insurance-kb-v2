/**
 * MCP Setup Page — gated by use_mcp feature.
 *
 * VIP / authorized users issue 90-day tokens here, copy the connector URL,
 * paste into claude.ai → Settings → Connectors → Add custom connector.
 *
 * Adapted from agent-kb/web/src/pages/McpSetup.tsx for Insurance KB v3.
 */

import React, { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';

interface McpSetupProps {
  readonly apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  readonly hasFeature: (key: string) => boolean;
}

interface TokenListItem {
  token_preview: string;
  token_id: string;
  label: string;
  expires_at: number;
}

interface IssueResponse {
  token: string;
  base_url: string;
  connector_url: string;
  label: string;
  expires_at: number;
  features: string[];
}

function formatExpiry(unixSec: number): string {
  const days = Math.max(0, Math.floor((unixSec - Date.now() / 1000) / 86400));
  return `${days} 天後到期`;
}

const RECOMMENDED_PROFILE = `Insurance KB（保險業界知識庫 + 研究報告產出）
- 透過 MCP 連線老師整理的保險新聞、月度蒸餾、研究報告
- 工具：list_articles / search_articles / list_reports / get_report / get_wiki / web_search
- 研究產出：start_research_session / confirm_scope / add_finding / list_findings / generate_outline / finalize_report
- 個人筆記區（如未來開放）

被問保險業界內容先查
- 提到「最近 X 公司」「某月有什麼大事」「以前有沒有研究」 → 先 search_articles / list_reports / get_wiki
- 找不到誠實說「KB 沒這條紀錄」，不要憑訓練資料編造

研究報告產出工作流
- 用戶說「我想做 X 主題研究」→ 呼叫 start_research_session 拿 5 步 todo
- **一步步引導用戶選範圍 (grill-mode：列選項+推薦+等用戶選)**，不要自己決定
- confirm_scope 後照 server 回的 todo 用 search_articles / list_reports / web_search 蒐集
- **每段證據呼叫 add_finding (source_url 必填，不能瞎掰)**
- 8-15 個 findings 後 generate_outline 跟用戶討論
- 用戶確認後寫 markdown (用 [^1] [^2] 引用 findings) → finalize_report 上架

風格
- 簡潔，不拍馬屁，不延伸給未被要求的建議
- 每個量化數字 / 競品名 / 公司動態 / 新聞事件**必須**對應一個 add_finding (source_url 必填)
- 「我訓練資料記得 X」不算合法來源，先 search_articles 或 web_search 找實際出處`;

export const McpSetupPage: React.FC<McpSetupProps> = ({ apiFetch, hasFeature }) => {
  const canUseMcp = hasFeature('use_mcp');
  const [tokens, setTokens] = useState<TokenListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState('');
  const [issuing, setIssuing] = useState(false);
  const [justIssued, setJustIssued] = useState<IssueResponse | null>(null);
  const [copyState, setCopyState] = useState<string>('');

  const refreshTokens = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await apiFetch('/api/mcp/my-tokens');
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || `HTTP ${resp.status}`);
      }
      const data = await resp.json() as { tokens: TokenListItem[] };
      setTokens(data.tokens);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tokens');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (canUseMcp) refreshTokens();
    else setLoading(false);
  }, [canUseMcp]);

  const handleIssue = async () => {
    if (issuing) return;
    setIssuing(true);
    setError(null);
    try {
      const resp = await apiFetch('/api/mcp/issue-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: newLabel.trim() || '預設' }),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || `HTTP ${resp.status}`);
      }
      const data = await resp.json() as IssueResponse;
      setJustIssued(data);
      setNewLabel('');
      await refreshTokens();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Issue failed');
    } finally {
      setIssuing(false);
    }
  };

  const handleRevoke = async (tokenId: string) => {
    if (!confirm('確定撤銷此 token？已連線的 claude.ai connector 會立即失效')) return;
    try {
      await apiFetch('/api/mcp/revoke-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokenId }),
      });
      await refreshTokens();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Revoke failed');
    }
  };

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(
      () => {
        setCopyState(label);
        setTimeout(() => setCopyState(''), 2000);
      },
      () => setCopyState('複製失敗'),
    );
  };

  if (!canUseMcp) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-md text-center text-slate-500">
          <h2 className="text-lg font-semibold mb-2 text-slate-700 dark:text-slate-300">MCP 連線</h2>
          <p className="text-sm leading-relaxed">
            需要 <span className="font-mono text-accent">use_mcp</span> 權限。<br />
            這項功能允許你把 Insurance KB 接到 claude.ai 的 chat（手機端或桌面端），<br />
            透過 AI 進行市場調查與研究報告產出。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-4xl mx-auto p-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold mb-1">MCP 連線設定</h1>
          <p className="text-[13px] text-slate-500">
            把 Insurance KB 接到 claude.ai chat — 透過 AI 做研究調查 + 產出報告
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-md bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* Step 1: Issue token */}
        <section className="mb-8 p-5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-6 h-6 rounded-full bg-accent text-white text-[12px] font-bold flex items-center justify-center">1</span>
            <h2 className="font-semibold">產生 Token</h2>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="標籤（可空白，例：iPhone / 個人用）"
              maxLength={40}
              className="flex-1 px-3 py-2 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm focus:outline-none focus:border-accent"
            />
            <button
              onClick={handleIssue}
              disabled={issuing}
              className="px-4 py-2 rounded-md bg-accent text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              {issuing ? '產生中…' : '產生 Token'}
            </button>
          </div>
          <p className="text-[11px] text-slate-500 mt-2">
            90 天有效期，每人最多 5 個 token。Token 含你目前的權限快照 — 權限變更後須重發。
          </p>
        </section>

        {/* Just-issued token (one-time display) */}
        {justIssued && (
          <section className="mb-8 p-5 rounded-lg border-2 border-accent bg-accent/5">
            <div className="flex items-center gap-2 mb-3">
              <Icon name="lock" className="w-4 h-4 text-accent" />
              <h2 className="font-semibold text-accent">Token 已產生（請立刻複製）</h2>
            </div>
            <p className="text-[12.5px] mb-3 text-slate-700 dark:text-slate-300">
              下次重新整理頁面就看不到完整 token 了。把 connector URL 貼到 claude.ai：
            </p>
            <div className="space-y-2">
              <div>
                <div className="text-[11px] text-slate-500 mb-1">Connector URL（貼到 claude.ai → Settings → Connectors → Add custom connector）</div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={justIssued.connector_url}
                    readOnly
                    className="flex-1 px-3 py-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-[12px] font-mono"
                    onFocus={(e) => e.target.select()}
                  />
                  <button
                    onClick={() => copy(justIssued.connector_url, 'connector URL')}
                    className="px-3 py-2 rounded-md border border-accent text-accent text-sm hover:bg-accent hover:text-white transition"
                  >
                    複製
                  </button>
                </div>
              </div>
            </div>
            {copyState && (
              <div className="mt-2 text-[12px] text-emerald-600 dark:text-emerald-400">
                ✓ 已複製{copyState}
              </div>
            )}
          </section>
        )}

        {/* Step 2: Existing tokens */}
        <section className="mb-8 p-5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-[12px] font-bold flex items-center justify-center">2</span>
            <h2 className="font-semibold">我的 Token</h2>
            <span className="ml-auto text-[11px] text-slate-500">{tokens.length} / 5</span>
          </div>
          {loading && <div className="text-slate-400 text-sm">載入中…</div>}
          {!loading && tokens.length === 0 && (
            <div className="text-slate-400 text-sm py-2">尚未產生任何 token</div>
          )}
          {!loading && tokens.length > 0 && (
            <div className="space-y-2">
              {tokens.map((t) => (
                <div
                  key={t.token_id}
                  className="flex items-center gap-3 p-3 rounded-md bg-slate-50 dark:bg-slate-800/50"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{t.label}</div>
                    <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                      {t.token_preview} · {formatExpiry(t.expires_at)}
                    </div>
                  </div>
                  <button
                    onClick={() => handleRevoke(t.token_id)}
                    className="text-[12px] text-red-500 hover:underline"
                  >
                    撤銷
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Step 3: Profile setup */}
        <section className="mb-8 p-5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 text-[12px] font-bold flex items-center justify-center">3</span>
            <h2 className="font-semibold">設定 claude.ai Profile</h2>
          </div>
          <p className="text-[12.5px] text-slate-600 dark:text-slate-400 mb-3 leading-relaxed">
            連線 connector 後還不夠 — 不設 profile 的話 AI 不知道有這 KB，被問保險主題會憑印象瞎答。<br />
            到 <a href="https://claude.ai/settings/profile" target="_blank" rel="noreferrer" className="text-accent underline">https://claude.ai/settings/profile</a> 把下面這段貼進「個性化指示」：
          </p>
          <div className="relative">
            <pre className="text-[11.5px] p-3 rounded-md bg-slate-50 dark:bg-slate-800 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed border border-slate-200 dark:border-slate-700">
{RECOMMENDED_PROFILE}
            </pre>
            <button
              onClick={() => copy(RECOMMENDED_PROFILE, 'profile 設定')}
              className="absolute top-2 right-2 px-2 py-1 rounded text-[11px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:border-accent hover:text-accent"
            >
              複製
            </button>
          </div>
          <p className="text-[11px] text-slate-500 mt-3">
            驗證：新開一個 chat 問「最近台灣壽險業有什麼大事」— AI 第一個動作應該是 search_articles 或 list_articles 而不是憑記憶答。
          </p>
        </section>
      </div>
    </div>
  );
};
