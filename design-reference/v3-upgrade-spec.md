# Insurance KB v3 升級 Spec

> 2026-05-05 制定。**直接更新 v2，不開新 repo**。配 Firestore migration script 補既有 member 的 view_wiki override，無感升級。
>
> Branch: `feat/v3-upgrade` → 完整完成 + 自我驗證後才 merge main。

## 升級內容

1. **權限模型 feature-based 化**（取代 `req: 'public/member/vip'` 硬寫）
2. **member 預設權限縮減**：登入後預設只看卡片，其他 features 由 admin 加授權
3. **新增研究報告系統**（reports CRUD + render + download PDF）
4. **新增 MCP server**（claude.ai connector + token UI，亞型 agent-kb 模式）
5. **MCP create_report**（VIP 透過 chat + MCP tools 上架研究報告）
6. **Research session 流程**（grill-mode 風格的引導式報告產出）

## Tier × Features 對應表

更新 Firestore `/projects/insurance-kb`：

```javascript
{
  defaultTier: 'member',  // 登入即 member
  tiers: {
    guest: {
      features: ['view_summary', 'view_card_titles']
    },
    member: {
      // 預設只看卡片內容。其他 features 要 admin per-user override。
      features: ['view_summary', 'view_card_titles', 'view_card_summary']
    },
    vip: {
      features: ['*']  // 萬用鑰匙：含所有 view + ai_chat + use_mcp + create_report + download_reports
    }
  },
  featureCatalog: {
    view_summary:      { label: '首頁 / 學習路徑', tierDefault: 'guest' },
    view_card_titles:  { label: '卡片標題列表',    tierDefault: 'guest' },
    view_card_summary: { label: '卡片內文 + 摘要', tierDefault: 'member' },
    view_wiki:         { label: '月度 / 季度 Wiki', tierDefault: 'admin-grant' },
    view_reports:      { label: '研究報告',         tierDefault: 'admin-grant' },
    ai_chat:           { label: 'Web AI 對話',     tierDefault: 'admin-grant' },
    use_mcp:           { label: 'MCP claude.ai 連線', tierDefault: 'admin-grant' },
    download_reports:  { label: '下載研究報告 (PDF)', tierDefault: 'admin-grant' },
    create_report:     { label: 'MCP 上架研究報告', tierDefault: 'vip-only' }
  }
}
```

## 既有用戶遷移策略

- V2 上線 2026-04-20 ~ 5/5 約 2 週，內部測試用戶 < 50 人
- **變動衝擊**：member 預設權限從「含 view_wiki」變成「不含」
- **解法**：跑一次 migration script，把所有現存 `/users/{uid}/memberships/insurance-kb` 文件補 `features: { view_wiki: true }` override
- 既有用戶 → 保留現有體驗，無感升級
- 新註冊的人 → 拿到新預設（限縮版）

詳見 `scripts/migrate-existing-members.ts`（dry-run mode 為預設）。

## Phase 進度

| Phase | 內容 | 狀態 |
|---|---|---|
| 0 | 規劃 / 評估 | ✅ 完成 |
| 1 | Feature gating 前端 + migration spec | 🔄 進行中（feat/v3-upgrade branch）|
| 2 | Reports CRUD + render + download | ⏳ |
| 3 | MCP server + token UI（source-copy from agent-kb） | ⏳ |
| 4 | Research session + create_report + 溯源機制 | ⏳ |

## Research Session 設計（Phase 4）

採 agent-kb 的 grill-mode 風格：用戶說「我想研究 X」→ MCP 回傳 5 步 todo（範圍/地區/時間/讀者/深度）→ chat 一步步引導 → 鎖定範圍後 server 回傳 research plan todo → chat 蒐集證據（每段 add_finding）→ generate_outline → finalize_report 上架。

### 溯源機制（**核心，多層強制**）

1. `add_finding(type, content, source_url, source_title, source_date)` — source_url **必填**，server schema 拒空
2. `finalize_report` 自動 append `## 參考資料` section
3. 內文用 markdown footnote `[^1]` `[^2]` 對應參考資料
4. Server 檢測「事實句 vs footnote 比」過低時警告
5. Render 報告時 footnote 可點直跳 source URL

Skill prompt 規定：每個量化數字 / 競品名 / 公司動態 / 新聞事件**必須**對應 add_finding。「我訓練資料記得 X」**不是合法來源**。

### Draft state 暫存

KV，TTL 24 小時。session 未 finalize 自動過期清掉。

## MCP Tools 完整清單

| Tool | 權限 | 用途 |
|---|---|---|
| `list_articles(query, limit, days)` | view_card_summary | 列保險新聞 |
| `search_articles(q)` | view_card_summary | 全文搜尋新聞 |
| `list_reports(filter)` | view_reports | 列舊報告 |
| `get_report(id)` | view_reports | 讀舊報告全文 |
| `get_wiki(month)` | view_wiki | 讀月度蒸餾 |
| `web_search(q)` | use_mcp | 外部網路搜尋（worker 代理）|
| `start_research_session(topic_seed)` | use_mcp | 啟動 session，回傳 5 步 todo |
| `confirm_scope(session_id, decisions)` | use_mcp | 鎖定範圍，回傳 research plan |
| `add_finding(session_id, type, content, source_url, source_title, source_date)` | use_mcp | 累積證據 |
| `list_findings(session_id)` | use_mcp | 看目前累積 |
| `generate_outline(session_id)` | use_mcp | 從 findings 生成大綱 |
| `finalize_report(session_id, title, markdown, tags)` | create_report | 上架報告 → D1 + R2 + git + TG 通知 |

## 報告儲存（Phase 2 設計）

三寫策略：
- **D1**（metadata）：id, title, author_uid, tags, status, created, updated, source_session_id
- **R2**（content）：`reports/{id}.md` 純 markdown，UTF-8
- **git snapshot**（備份 + 版控）：commit 進 v2 repo `compiled/reports/{yyyy-mm}/{id}.md`，跟著每日 crawl commit 走

## 下載格式（Phase 2）

| 格式 | MVP | 備註 |
|---|---|---|
| Markdown | ✅ | source-of-truth，零成本 |
| PDF | ✅ | print CSS + Cmd+P，零工程 |
| Word (.docx) | 🟡 第二階段 | 用 npm `docx` 套件動態產，套雙週報 template |

## 跨專案待辦（cooperation-hub 升級項）

未來：用戶 Web 點鎖定功能可發「申請存取」請求 → Firestore queue → admin TG 通知 → 點按鈕核准 → Firestore features override → Web 即時刷新。涉及 cooperation-hub admin UI + TG bot integration 升級，所有用此會員系統的專案都受惠。

當前用「靜默鎖」UX 已足夠（用戶量小，admin 直接 Firestore Console 改即可）。等 v3 上線看哪些 feature 申請頻率高再做。
