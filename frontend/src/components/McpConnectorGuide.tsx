/**
 * McpConnectorGuide — MCP 連線的圖文教學 + 跨 client config recipe。
 *
 * 移植自 agent-kb/web/src/pages/McpSetup.tsx 的 ChatGptMcpGuide + ClientRecipes，
 * 適配 Insurance KB：保險研究場景、第 6 步改成「研究報告產出」（insurance-kb 無筆記
 * 功能）、Icon 替換（insurance-kb 沒有 check/slides → 用 ✓ 文字 / cards）、原生 button。
 *
 * 用 CSS mockup 模擬 ChatGPT 設定畫面，避免真實截圖外露 token/帳號。claude.ai 連法
 * 走 McpSetup 主頁的 profile 區；本元件補 ChatGPT App 接法 + 其他 MCP client。
 */

import React, { useState } from 'react';
import { Icon } from './Icon';

interface McpConnectorGuideProps {
  /** 剛產生的 connector URL（含 token）；無 token 時 recipes 顯示提示 */
  readonly connectorUrl?: string;
  readonly token?: string;
  readonly baseUrl?: string;
}

export const McpConnectorGuide: React.FC<McpConnectorGuideProps> = ({ connectorUrl, token, baseUrl }) => (
  <>
    <ChatGptMcpGuide />
    <ClientRecipes connectorUrl={connectorUrl} token={token} baseUrl={baseUrl} />
  </>
);

// ─────────────────────────────────────────────────────────────────
// ChatGptMcpGuide — ChatGPT 應用程式接 Insurance KB 的圖文教學
// ─────────────────────────────────────────────────────────────────

const ChatGptMcpGuide: React.FC = () => {
  const steps = [
    {
      title: '1. 先在 ChatGPT 網頁版開啟開發者模式',
      body: '桌面網頁版才看得到設定入口。進入設定後選「應用程式」，打開「進階設定」，啟動開發者模式，再點「建立應用程式」。',
      mockup: <SettingsMockup />,
    },
    {
      title: '2. 先取得 Insurance KB 的 MCP 權限',
      body: '如果你的側欄沒有「MCP 連線」選單，代表帳號還沒開通 use_mcp。請先向管理者申請；權限開通後，再回本頁產生 URL + token。',
      mockup: <PermissionMockup />,
    },
    {
      title: '3. 在 Insurance KB 產生 URL + token',
      body: '回到 MCP 設定頁點「產生 Token」，複製出現的整段連接器 URL。這段 URL 已含 token，不要拆開貼。',
      mockup: <TokenMockup />,
    },
    {
      title: '4. 貼到 ChatGPT 的 New App 表單',
      body: 'MCP URL 貼整段 URL，名稱填「Insurance KB」。驗證方式選「無驗證」，因為 server 會用 URL 內的 token 自己驗證。勾選了解後建立。',
      mockup: <NewAppMockup />,
    },
    {
      title: '5. 回到對話視窗選 Insurance KB',
      body: '開新對話或回到既有對話，點輸入框旁的加號，選「Insurance KB」。看到工具掛上後，就能問保險新聞、月度趨勢、研究報告。',
      mockup: <ChatMockup />,
    },
    {
      title: '6. 用自然語言做研究、產出報告',
      body: '選了 Insurance KB 後，說「我想做 X 主題研究」會啟動 grill-mode 引導（列選項讓你選範圍）→ 蒐集 finding → 上架研究報告，回網頁就能看到。',
      mockup: <ResearchMockup />,
    },
  ];

  return (
    <section className="mt-10">
      <div className="mb-4">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-accent font-semibold mb-1">
          <Icon name="cards" className="w-4 h-4" />
          CHATGPT MCP WALKTHROUGH
        </div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">怎麼用 ChatGPT 應用程式接 Insurance KB</h2>
        <p className="mt-1 text-[13.5px] text-slate-600 dark:text-slate-400">
          這段用簡化 mockup 對齊 ChatGPT 設定畫面。重點是讓你知道去哪點、貼哪一段、建立後怎麼確認成功。（claude.ai 連法見上方 profile 區。）
        </p>
      </div>

      <div className="space-y-3">
        {steps.map((s) => (
          <article
            key={s.title}
            className="grid gap-4 rounded-lg ring-1 ring-slate-200 dark:ring-slate-800 bg-white dark:bg-slate-900 px-4 py-4 md:grid-cols-[minmax(0,1fr)_320px]"
          >
            <div>
              <h3 className="text-[14.5px] font-semibold text-slate-900 dark:text-slate-100">{s.title}</h3>
              <p className="mt-1 text-[13px] leading-relaxed text-slate-600 dark:text-slate-400">{s.body}</p>
            </div>
            {s.mockup}
          </article>
        ))}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-lg bg-emerald-50 dark:bg-emerald-500/10 ring-1 ring-emerald-200 dark:ring-emerald-500/20 px-4 py-3">
          <h3 className="text-[13px] font-semibold text-emerald-800 dark:text-emerald-300">設定成功的判斷</h3>
          <ul className="mt-2 space-y-1 text-[12.5px] text-emerald-800/80 dark:text-emerald-200/80">
            <li>對話框加號選單看得到 Insurance KB。</li>
            <li>問「最近台灣壽險業有什麼大事」時，模型會呼叫 search_articles / list_articles，而不是憑記憶答。</li>
            <li>說「我想做 X 研究」後會走 grill-mode 引導、最後 create_report 上架。</li>
          </ul>
        </div>
        <div className="rounded-lg bg-amber-50 dark:bg-amber-500/10 ring-1 ring-amber-200 dark:ring-amber-500/20 px-4 py-3">
          <h3 className="text-[13px] font-semibold text-amber-800 dark:text-amber-300">最常卡住的地方</h3>
          <ul className="mt-2 space-y-1 text-[12.5px] text-amber-800/80 dark:text-amber-200/80">
            <li>用手機 App 或桌面 App 找設定：請改用網頁版。</li>
            <li>沒有「MCP 連線」選單：請向管理者申請 use_mcp 權限。</li>
            <li>驗證選 OAuth：請改成「無驗證」，token 已在 URL 裡。</li>
          </ul>
        </div>
      </div>
    </section>
  );
};

const MockShell: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/70 p-3">
    <div className="mb-2 flex items-center justify-between">
      <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{title}</span>
      <span className="h-2 w-2 rounded-full bg-emerald-400" />
    </div>
    {children}
  </div>
);

const SettingsMockup: React.FC = () => (
  <MockShell title="ChatGPT / 設定彈窗">
    <div className="overflow-hidden rounded-lg bg-white ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <div className="grid grid-cols-[92px_1fr]">
        <div className="space-y-1 border-r border-slate-100 bg-slate-50 p-2 dark:border-slate-800 dark:bg-slate-950">
          {['一般', '通知', '個人化', '應用程式', '排程', '帳單'].map((label) => (
            <div
              key={label}
              className={`rounded-md px-2 py-1 text-[10.5px] ${label === '應用程式' ? 'bg-slate-200 font-medium text-slate-900 dark:bg-slate-800 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400'}`}
            >
              {label}
            </div>
          ))}
        </div>
        <div className="p-3">
          <div className="mb-3 flex items-center justify-between border-b border-slate-100 pb-2 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                KB
              </div>
              <div className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">應用程式</div>
            </div>
            <span className="rounded-full border border-slate-200 px-2 py-1 text-[10.5px] font-medium text-slate-700 dark:border-slate-700 dark:text-slate-200">
              建立應用程式
            </span>
          </div>

          <div className="mb-3 flex items-center justify-between rounded-md px-1.5 py-2">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
                <Icon name="slider" className="h-4 w-4 text-slate-600 dark:text-slate-300" />
              </div>
              <span className="text-[12px] font-medium text-slate-800 dark:text-slate-100">進階設定</span>
            </div>
            <Icon name="chevR" className="h-4 w-4 text-slate-400" />
          </div>

          <div className="space-y-2 border-t border-slate-100 pt-2 dark:border-slate-800">
            {['保險', 'Insurance KB'].map((label) => (
              <div key={label} className="flex items-center justify-between rounded-md px-1.5 py-1.5">
                <div className="flex items-center gap-2">
                  <div className="h-7 w-7 rounded-full bg-slate-100 dark:bg-slate-800" />
                  <span className="text-[11.5px] text-slate-700 dark:text-slate-200">{label}</span>
                  <span className="rounded-full border border-red-100 px-1.5 py-0.5 text-[9px] font-semibold text-red-500 dark:border-red-500/20">DEV</span>
                </div>
                <Icon name="chevR" className="h-3.5 w-3.5 text-slate-400" />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="border-t border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/70">
        <div className="mb-2 flex items-center gap-2">
          <Icon name="chevL" className="h-4 w-4 text-slate-500" />
          <span className="text-[12px] font-semibold text-slate-900 dark:text-slate-100">進階設定</span>
        </div>
        <div className="flex items-center justify-between rounded-md bg-white p-2 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          <div>
            <div className="text-[12px] font-medium text-slate-800 dark:text-slate-100">開發者模式</div>
            <div className="text-[10px] text-slate-500 dark:text-slate-400">啟用後才能建立自訂 MCP 應用程式</div>
          </div>
          <span className="h-5 w-9 rounded-full bg-blue-500 p-0.5">
            <span className="block h-4 w-4 translate-x-4 rounded-full bg-white" />
          </span>
        </div>
      </div>
    </div>
  </MockShell>
);

const PermissionMockup: React.FC = () => (
  <MockShell title="Insurance KB / 側欄權限">
    <div className="grid grid-cols-[92px_1fr] overflow-hidden rounded-lg bg-white ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <div className="space-y-1 bg-slate-50 p-2 dark:bg-slate-950">
        {['首頁', '新聞卡片', '月度 Wiki', '研究報告'].map((label) => (
          <div key={label} className="rounded-md px-2 py-1 text-[10.5px] text-slate-500 dark:text-slate-400">
            {label}
          </div>
        ))}
        <div className="rounded-md border border-dashed border-amber-300 bg-amber-50 px-2 py-1 text-[10.5px] font-medium text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          MCP 連線
        </div>
      </div>
      <div className="p-3">
        <div className="mb-2 flex items-center gap-2">
          <Icon name="lock" className="h-4 w-4 text-amber-600 dark:text-amber-300" />
          <span className="text-[12px] font-semibold text-slate-800 dark:text-slate-100">看不到 MCP 連線？</span>
        </div>
        <p className="text-[11.5px] leading-relaxed text-slate-600 dark:text-slate-300">
          請向管理者申請 use_mcp 權限。開通後，側欄會出現「MCP 連線」，才能產生 URL + token。
        </p>
        <div className="mt-3 rounded-md bg-emerald-50 px-2 py-1.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
          權限開通後：MCP 連線可點擊
        </div>
      </div>
    </div>
  </MockShell>
);

const TokenMockup: React.FC = () => (
  <MockShell title="Insurance KB / MCP 連線設定">
    <div className="space-y-2">
      <div className="rounded-md bg-accent px-3 py-2 text-center text-[12px] font-medium text-white">
        產生 Token
      </div>
      <div className="rounded-md bg-white dark:bg-slate-900 p-2 ring-1 ring-accent">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-slate-500">URL + token</span>
          <span className="rounded bg-accent/10 px-2 py-1 text-[10.5px] font-medium text-accent">複製整段</span>
        </div>
        <div className="truncate font-mono text-[10.5px] text-accent">https://.../mcp/sse?token=mcp_...</div>
      </div>
    </div>
  </MockShell>
);

const NewAppMockup: React.FC = () => (
  <MockShell title="ChatGPT / New App 彈窗">
    <div className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <div className="mb-3 flex items-center justify-between border-b border-slate-100 pb-2 dark:border-slate-800">
        <div className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">New App</div>
        <Icon name="x" className="h-4 w-4 text-slate-600 dark:text-slate-300" />
      </div>

      <div className="space-y-2">
        <MockInput label="名稱" value="Insurance KB" />
        <MockInput label="MCP 伺服器 URL" value="https://.../mcp/sse?token=mcp_..." />

        <div className="relative rounded-md bg-white p-2 ring-1 ring-slate-300 dark:bg-slate-900 dark:ring-slate-700">
          <div className="mb-1 text-[10px] font-semibold text-slate-700 dark:text-slate-200">驗證</div>
          <div className="rounded-md border border-slate-300 px-2 py-1.5 text-[11.5px] text-slate-700 dark:border-slate-700 dark:text-slate-200">
            無驗證
          </div>
          <div className="absolute left-2 right-2 top-[54px] z-10 rounded-md border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
            {['OAuth', '無驗證', '混合'].map((label) => (
              <div
                key={label}
                className={`flex items-center gap-2 px-2 py-1 text-[11.5px] ${label === '無驗證' ? 'bg-blue-500 text-white' : 'text-slate-700 dark:text-slate-200'}`}
              >
                <span className="w-3">{label === 'OAuth' ? '✓' : ''}</span>
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-12 rounded-lg border border-orange-100 bg-orange-50 text-orange-800 dark:border-orange-500/20 dark:bg-orange-500/10 dark:text-orange-200">
          <div className="border-b border-orange-100 px-3 py-2 text-[11.5px] font-semibold dark:border-orange-500/20">
            自訂 MCP 伺服器會引入風險
          </div>
          <div className="flex items-start gap-2 px-3 py-2 text-[10.5px] leading-relaxed">
            <span className="mt-0.5 h-3 w-3 rounded-sm border border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-900" />
            <span>我了解並想繼續</span>
          </div>
        </div>

        <div className="rounded-full bg-slate-300 px-3 py-2 text-center text-[12px] font-medium text-white dark:bg-slate-700">
          建立
        </div>
      </div>
    </div>
  </MockShell>
);

const ChatMockup: React.FC = () => (
  <MockShell title="ChatGPT / 對話">
    <div className="rounded-md bg-white dark:bg-slate-900 p-3 ring-1 ring-slate-200 dark:ring-slate-800">
      <div className="mb-2 rounded-md bg-slate-100 px-2 py-1 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
        +  選擇工具：Insurance KB
      </div>
      <div className="rounded-md border border-accent/40 bg-accent/10 px-2 py-2 text-[11.5px] text-slate-700 dark:text-slate-200">
        最近台灣壽險業有什麼大事？用 Insurance KB 查
      </div>
    </div>
  </MockShell>
);

const ResearchMockup: React.FC = () => (
  <MockShell title="Insurance KB / 研究報告">
    <div className="space-y-2">
      <div className="rounded-md bg-white dark:bg-slate-900 p-2 ring-1 ring-slate-200 dark:ring-slate-800">
        <div className="text-[11px] font-medium text-slate-800 dark:text-slate-100">高齡醫療費用研究 V1</div>
        <div className="mt-1 text-[10.5px] text-slate-500 dark:text-slate-400">來源：MCP / research session</div>
      </div>
      <div className="rounded-md bg-emerald-50 px-2 py-1.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
        已上架，可在「研究報告」頁查看
      </div>
    </div>
  </MockShell>
);

const MockInput: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <label className="block rounded-md bg-white dark:bg-slate-900 p-2 ring-1 ring-slate-200 dark:ring-slate-800">
    <span className="block text-[10px] text-slate-500">{label}</span>
    <span className="mt-1 block truncate font-mono text-[11px] text-slate-700 dark:text-slate-300">{value}</span>
  </label>
);

// ─────────────────────────────────────────────────────────────────
// ClientRecipes — 跨 client config snippet 一鍵複製（token 已預填）
// ─────────────────────────────────────────────────────────────────

interface ClientRecipesProps {
  readonly connectorUrl?: string;
  readonly token?: string;
  readonly baseUrl?: string;
}

const ClientRecipes: React.FC<ClientRecipesProps> = ({ connectorUrl, token, baseUrl }) => {
  const [copiedClient, setCopiedClient] = useState<string | null>(null);

  if (!connectorUrl || !token || !baseUrl) {
    return (
      <div className="mt-6 rounded-lg ring-1 ring-dashed ring-slate-300 dark:ring-slate-700 px-5 py-6 text-center text-[12.5px] text-slate-500 dark:text-slate-400">
        產生 token 後，這裡會出現 Cursor / Codex / Claude Desktop / Antigravity 各 client 的設定（token 自動預填、一鍵複製）。
      </div>
    );
  }

  const onCopy = (id: string, content: string) => {
    navigator.clipboard.writeText(content).then(
      () => {
        setCopiedClient(id);
        setTimeout(() => setCopiedClient((c) => (c === id ? null : c)), 2000);
      },
      () => window.prompt(`手動複製 ${id} 設定：`, content),
    );
  };

  const cursorConfig = JSON.stringify({ url: connectorUrl, type: 'sse' });
  const cursorInstallUrl = `cursor://anysphere.cursor-deeplink/mcp/install?name=insurance-kb&config=${btoa(cursorConfig)}`;
  const codexToml = `[mcp.servers.insurance-kb]\nurl = "${baseUrl}"\nauth_header = "Bearer ${token}"`;
  const claudeDesktopJson = JSON.stringify({ mcpServers: { 'insurance-kb': { url: connectorUrl, transport: 'sse' } } }, null, 2);
  const cursorJson = JSON.stringify({ mcpServers: { 'insurance-kb': { url: connectorUrl, type: 'sse' } } }, null, 2);
  const antigravityJson = JSON.stringify({ 'insurance-kb': { url: connectorUrl, transport: 'sse' } }, null, 2);

  const recipes = [
    { id: 'cursor-deeplink', label: 'Cursor（一鍵安裝）', hint: 'cursor:// deep-link，點下跳 Cursor app 直接安裝', kind: 'deeplink' as const, url: cursorInstallUrl },
    { id: 'cursor-json', label: 'Cursor（手動 JSON）', hint: '貼到 .cursor/mcp.json 或 ~/.cursor/mcp.json', kind: 'snippet' as const, content: cursorJson },
    { id: 'codex', label: 'Codex CLI（TOML）', hint: '貼到 ~/.codex/config.toml', kind: 'snippet' as const, content: codexToml },
    { id: 'claude-desktop', label: 'Claude Desktop（JSON）', hint: 'macOS: ~/Library/Application Support/Claude/claude_desktop_config.json', kind: 'snippet' as const, content: claudeDesktopJson },
    { id: 'antigravity', label: 'Antigravity / Gemini CLI（JSON）', hint: 'IDE Settings → MCP servers → Add；或 ~/.gemini/mcp.json', kind: 'snippet' as const, content: antigravityJson },
  ];

  return (
    <div className="mt-6 pt-5 border-t border-slate-200 dark:border-slate-800">
      <h3 className="text-[13.5px] font-semibold text-slate-900 dark:text-slate-100 mb-1">
        其他 MCP client 設定（token 已預填）
      </h3>
      <p className="text-[11.5px] text-slate-600 dark:text-slate-400 mb-3">
        claude.ai 走上方 connector + profile。下方是 Cursor / Codex / Claude Desktop / Antigravity 的設定，token 已填好。
      </p>

      <ul className="space-y-2">
        {recipes.map((r) => (
          <li key={r.id} className="rounded-lg ring-1 ring-slate-200 dark:ring-slate-800 bg-white dark:bg-slate-900 px-3 py-2.5">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-slate-900 dark:text-slate-100">{r.label}</div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">{r.hint}</div>
              </div>
              {r.kind === 'deeplink' ? (
                <a
                  href={r.url}
                  className="shrink-0 inline-flex items-center gap-1 px-3 h-7 rounded-md bg-accent text-white text-[11.5px] font-medium hover:opacity-90 transition"
                >
                  <Icon name="ext" className="w-3 h-3" />
                  一鍵安裝
                </a>
              ) : (
                <button
                  onClick={() => onCopy(r.id, r.content!)}
                  className="shrink-0 inline-flex items-center gap-1 px-3 h-7 rounded-md ring-1 ring-slate-200 dark:ring-slate-800 text-[11.5px] font-medium text-slate-700 dark:text-slate-300 hover:ring-accent hover:text-accent transition"
                >
                  {copiedClient === r.id ? '已複製 ✓' : '複製設定'}
                </button>
              )}
            </div>
            {r.kind === 'snippet' && (
              <pre className="text-[10.5px] font-mono bg-slate-50 dark:bg-slate-950/60 rounded px-2 py-1.5 overflow-x-auto text-slate-600 dark:text-slate-400 max-h-[60px]">
                {r.content!.split('\n').slice(0, 3).join('\n')}
                {r.content!.split('\n').length > 3 ? '\n…' : ''}
              </pre>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};
