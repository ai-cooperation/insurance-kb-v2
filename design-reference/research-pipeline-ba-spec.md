# 研究報告 b→a 兩段式重構 SPEC

> Status: **REV 2（2026-08-02）** — 使用者拍板開工方向；§14-16 為本次修訂，與 §6 衝突處以 §14 為準
> 動機來源：2026-06-14 南山白皮書事件 — ChatGPT 端工具呼叫被 OpenAI safety filter 間歇攔截，研究流程卡死。
> 範本：paperlab（paperlab-kb worker = b 段 intake / a 段 pipeline @ ac-2012）。
> 決策（2026-06-14）：a 段共用 paper 引擎 runtime + 加 insurance lane；先落 SPEC 再 review。
> **決策（2026-08-02，使用者拍板）**：
> 1. 接兩種任務：**VIP 研究報告** + **月度深度分析**（§15）
> 2. 流程：VIP 在 chat grill → contract →（其餘全在 a 段）
> 3. 產出進**現有 reports D1**（VIP 前端可見）；quality gate fail-closed，**N 輪修不過才 TG 問使用者**（同 paperlab 行為）
> 4. a 段 runtime = **ac-2012 B engine（Hermes 單一長 session）**，非原草稿的 paperclaw phase machine（§14 實查 + 修正）

---

## 1. 背景與動機

保險 MCP 現在的研究報告工作流 **所有重活都壓在 b 段（前端 chat）**：`list_articles` / `web(search/fetch)` / `add_finding` / 寫內文全靠前端 LLM 逐步呼叫工具。問題：

1. **OpenAI safety filter 攔截**（南山 log 實證）：ChatGPT 端工具呼叫間歇被「此工具调用被 OpenAI 的安全检查屏蔽」攔，含數字/貨幣符號/URL 的呼叫尤其常中。攔在 OpenAI 平台層，請求根本沒到我們 server（ring buffer 無 trace）。我們無從修。
2. **前端授權摩擦 + 不穩定**：Claude 端要逐次 approval；前端 AI 自己沒紀律會盲目重送。
3. **重活壓前端**：寫 depth=C 報告約 100-150K tokens 推理，全在 chat 端，慢且脆。

**核心洞察**：把這些工具呼叫搬到後端 a 段 agent 自己跑，**完全不經過 ChatGPT/Claude 的 tool-call 通道 → 一次繞過 safety filter + 授權 + 前端不穩定**。

## 2. b/a 段定義（保險版，對照 paperlab）

| | **b 段（intake，現有 insurance-kb worker）** | **a 段（pipeline，共用 paperclaw runtime）** |
|---|---|---|
| Host | `insurance-kb-api.alan-chen75.workers.dev` | `paper-a.cooperation.tw`（共用，用 task_type 路由 recipe）|
| 職責 | grill 收斂 → `research_contract` → handoff | 收 contract 非同步跑：蒐證 → findings → 寫章節 → quality gate → 上架 → 通知 |
| 性質 | 同步、輕量、可中斷、需用戶互動 | 非同步、重活、後端自跑工具、自帶重試紀律 |
| LLM | claude.ai/ChatGPT 自帶（零成本）| paperclaw llm-adapter（pluggable，跟 paperlab 同 config）|

> 命名注意：paperlab README 用「Phase A=intake」，但 code 用 a-side=pipeline / b-side=intake。本 SPEC 一律以 **code 慣例**為準：**b=intake、a=pipeline**。

## 3. 目標架構

```
b 段 insurance-kb worker                          a 段 paperclaw @ paper-a
─────────────────────────                        ──────────────────────────
start_research_session (grill) ─┐
confirm_scope          (grill) ─┤
  → research_contract           │  POST /jobs
submit_to_research_pipeline ────┼──(contract+Idempotency-Key)──▶ insurance_research recipe:
  (D1: ready→pending_sync→sub)  │                                 1 讀 articles.json（不經 chat）
check_research_job  ◀───────────┼──GET /jobs/{id}/status────────  2 打 Exa web（不經 chat）
get_report/list_reports (留 b)  │                                 3 累積 findings（含 source_url）
                                │                                 4 逐章寫內文（pluggable LLM, [^N]）
report 上架 D1/R2/git ◀─────────┼──POST /api/research-pipeline/   5 checkReportQuality（複用）
  (複用 createReport)           │      complete?key=<secret>      6 createReport 回流
                                │                                 7 TG/email 通知
```

## 4. 工作分配

| 工作 | 歸屬 | 理由 |
|---|---|---|
| `start_research_session` / `confirm_scope` | 留 b | 輕量、需互動、不被攔 |
| `list_articles` / `search_articles` | 搬 a | 🔴 被攔；a 段直接讀 articles.json |
| `web(search/fetch)` | 搬 a | 🔴 最常被攔 + 重活；a 段直接打 Exa |
| `add_finding` | 搬 a | 🔴 數字/貨幣符號被攔；a 段自己寫 |
| `generate_outline` + 寫章節內文 | 搬 a | 🔴 重活；a 段 pluggable LLM |
| quality gate + `create_report` | 搬 a（複用現有 code）| a 段跑完直接上架 |
| `get_report` / `list_reports` / `list_topic_progress` / `get_wiki` | 留 b | 讀取查看 |
| `update_report`（Tier 3，2026-06-11 已上）| 留 b | 上架後就地改，獨立於 pipeline |

## 5. `research_contract`（b 段唯一產出 = handoff 介面）

```jsonc
{
  "task_type": "insurance_research",   // a 段 phase-loader 用來選 recipe
  "topic": "南山健康轉型白皮書",
  "topic_id": "topic_nanshan_health_transformation_whitepaper_2026",  // 沿用既有主題
  "topic_title": "...", "topic_summary": "...",   // 若新建主題
  "sort_order": 10,                    // 沿用 list_topic_progress 建議
  "scope": "company|single-market|cross-market",
  "region": "TW",
  "timeframe_days": 365,
  "audience": "商品設計團隊",
  "depth": "C",                        // 沿用現有 threshold A500/B1500/C2500
  "sub_questions": ["...", "..."],     // ★ grill 收斂的章節骨架；a 段照此蒐證+寫章節
  "seed_sources": ["https://..."],     // 用戶指定來源（可選）
  "author_uid": "...", "author_email": "..."  // 從 b 段 session 帶過去，上架時記作者
}
```

**b 段 grill 的唯一職責 = 把模糊主題填滿這張 contract。** 注意「具體性」如何分配（回答「a 段怎麼知道要做什麼」）：
- **`topic_brief`（40-80 字）= 研究企圖的主要載體**：講清「研究誰、什麼轉型、對標誰、給誰看」（如「南山人壽健康轉型白皮書：商品/通路/客戶經營轉型路徑，對標同業健康生態圈，供商品設計團隊」）。公司名/一般描述不觸發 safety（攔的是密集數字/貨幣/URL）。
- **`sub_questions` = 抽象章節角度**（見 §12.4），不含數字/競品名/URL。
- **a 段 P0 plan phase**（見 §6）把 `topic_brief + scope + region + sub_questions` 組合**展開成具體查詢計畫**（加公司名/年度/數字維度/對標競品）。
- **具體數字（27.3 萬人、ROI…）是 a 段蒐證的「產出」，不是 b 段的「輸入」**。用戶若有指定素材 → `seed_sources`（先簡化為口頭講、a 段自己找；out-of-band 上傳留待之後）。

## 6. a 段 insurance_research recipe（paperclaw phase 集合）

新增一組 phases 給 paperclaw phase-loader（取代 11-phase 論文流程）：

| phase | 動作 | 複用 |
|---|---|---|
| **P0 plan** ★ | **把抽象 sub_questions 在具體 topic 脈絡下展開成「查詢計畫」**：每條 sub_question → 具體 search queries（含公司名/年度/數字維度）+ 對標競品 + 要找的數據維度。**這是抽象 contract → 具體研究的轉換器**（在後端做，不怕攔）。沒這步，光抽象問題會蒐到泛泛新聞。 | paperclaw orchestrator + llm-adapter |
| P1 kb_gather | 依 **P0 查詢計畫** 讀 articles.json 篩相關文章 | 保險 search.ts 邏輯 |
| P2 web_gather | 對每個 sub_question 打 Exa search + 必要時 fetch 全文 | 保險 handleWebSearch 邏輯 |
| P3 findings | 把 P1/P2 證據整理成 findings（每筆強制 source_url）| 保險 add_finding schema |
| P4 write | 依 sub_questions 逐章寫內文（[^N] 引用 findings），depth 決定字數 | paperclaw llm-adapter |
| P5 quality（**自我迴圈**）★ | 跑 checkReportQuality → 撞 block（body 太薄/footnote orphan/量化沒實數）→ **自己回 P0-P4 補蒐證/擴寫/補 finding → 重跑，達標才往下**（最多 N 輪）；warn 修不掉寫進報告 caveat。見 §13。 | 保險 checkReportQuality + paperclaw quality-gate 迴圈 |
| P6 publish | 把 markdown+meta 回流保險上架 | 見 §7 回流 |
| P7 notify | TG/email 通知完成 + report URL | 保險 notifyTelegramNewReport |

LLM：用 paperclaw llm-adapter（provider/model/apiKey），跟 paperlab 同一套 config（pluggable，可換 provider）。

## 7. handoff API（兩端，照 paperlab + secret-key 回流）

**b→a（submit）**：新增 b 段工具 `submit_to_research_pipeline(session_id, notify_email?)`
- D1-first：先把 session 的 contract 存成 research_job（status=`ready`→`pending_sync`），再 `POST {INSURANCE_A_URL}/jobs`（body=contract, header `Idempotency-Key: insurance:{session_id}`）→ 存回 `job_id`、status=`submitted`。
- 冪等：同 session 重複 submit 不 double-trigger；`pending_sync` 可重試。
- 配 `GET {a}/capabilities` 確認 a 段宣告 `insurance_research` recipe；`POST {a}/jobs/dry-run` 提交前驗 contract。

**a→b（回流上架）**：a 段 P6 完成後 `POST {WORKER}/api/research-pipeline/complete?key=<RESEARCH_PIPELINE_KEY>`
- body = `{ job_id, contract, markdown, meta }`
- worker 驗 secret-key（複用 reference_admin-test-endpoint-pattern）→ 內部呼叫 `createReport`（D1+R2+git 三寫）→ 把 research_job status=`completed` + report_id。
- 為什麼用 secret-key endpoint 而非 a 段直接寫 D1：a 段不持有保險 D1/R2 binding，回流走 worker 既有上架邏輯（quality gate 已在 P5 跑過）最乾淨、單一上架路徑。

**b poll**：新增 `check_research_job(job_id)` → `GET {a}/jobs/{id}/status`，回 running/completed/failed + report URL。

## 8. state machine（D1 research_jobs 表）

```
contract saved (ready)
   → pending_sync         (b 呼叫 a /jobs 前)
   → submitted {job_id}   (a 接受)
   → running              (a 跑 P1-P5)
   → completed {report_id}(a POST complete → worker createReport)
   | failed {error}       (任何 phase 失敗，contract 仍在 D1 可重 submit)
```

## 9. 複用 vs 新建

**複用現有保險 code（重要：不要重寫）**：
- `checkReportQuality`（mcp.ts）→ a 段 P5
- `createReport` / `updateReport`（reports-store.ts）→ a 段回流 P6
- `loadArticles` / search（search.ts）→ a 段 P1
- `handleWebSearch` Exa 邏輯（mcp.ts）→ a 段 P2
- `notifyTelegramNewReport` → a 段 P7
- add_finding 的 source_url 強制 schema → a 段 P3

**新建**：
- b 段：`submit_to_research_pipeline` / `check_research_job` 工具 + research_jobs D1 表 + state machine（照 paperlab pipeline.ts）
- worker：`/api/research-pipeline/complete?key=` 回流 endpoint
- a 段：paperclaw insurance_research recipe（P1-P7 phases）+ 在 paper-a 註冊 task_type 路由
- secret：`RESEARCH_PIPELINE_KEY`（worker secret）、`INSURANCE_A_URL`（worker var，預設 paper-a）

## 10. 漸進實作階段

- **Phase 1（b 段 contract + handoff，a 段 stub）**：grill 改產 research_contract；submit_to_research_pipeline + check_research_job + research_jobs 表；a 段先回 stub job。可先驗 handoff 流程通。
- **Phase 2（a 段 recipe 蒐證 + findings）**：paperclaw insurance_research recipe P1-P3（KB+Exa+findings），跑出 findings 存 job。
- **Phase 3（a 段寫作 + quality + 回流）**：P4-P6，寫章節 + quality gate + `/complete` 回流上架。端到端打通。
- **Phase 4（通知 + 強化）**：P7 通知；dry-run/capabilities gate；失敗重試；觀測。

每階段可獨立驗證、漸進切換（b 段保留舊的 chat 端直接 create_report 路徑當 fallback，直到 a 段穩定）。

## 11. 開放問題 / 待 review 拍板

1. **a 段 LLM 選哪個 provider/model**（pluggable，但要定預設）——跟 paperlab 同 config？還是保險另設（depth=C 品質敏感，之前實證 paid Opus/GPT-5.5 > gemini-flash）？
2. **paper-a 的 /jobs server 怎麼註冊 insurance_research recipe**——要看 paper-a 機器上的 job server wrapper（不在 paperclaw core repo），確認 task_type 路由機制。
3. ~~**grill 在 b 段做到多細**~~ **已由 codex gpt-5.5 解答（見 §12）**：sub_questions = 章節級抽象問題、4-7 條、每條 12-40 字、禁數字/貨幣/URL；a 段才把每條展開成含公司名/年度/數字的查詢計畫。
4. **舊路徑何時退場**——chat 端直接 create_report 是否保留給「快速短報告」，還是全導 pipeline。
5. **回流冪等**——同 job_id 重複 POST /complete 要擋 double create_report（用 job_id 查 research_jobs.report_id 已存在則 skip）。

---

## 12. b 段防攔截設計（low-entropy intake）★ codex gpt-5.5 review 2026-06-14

> 核心定位：**b 段是「低熵 intake」，不是「微型研究」**。用戶最擔心的是「grill 階段仍在 ChatGPT 跑、會不會也被攔」。codex（OpenAI 自家模型，查過官方 Apps SDK + safety docs）的結論：**只要 b 段 tool args 維持短/結構化/非證據型，被攔風險明顯低於 web(fetch)/add_finding；但邊界要切乾淨。** 官方沒公開 filter heuristic，以下是實測 pattern + 官方設計原則推導。

### 12.1 tool args 風險原則
- **低風險形狀**：`enum + 短文字 + session_id`。
- **高風險形狀**：`URL / 密集數字 / 貨幣符號 / 長自由文字 / 重複重送 / 混合標點`。
- `region="台灣"` 被攔、`"TW"` 通過 = 「自由語言欄位不如代碼 enum 穩」的直接訊號。

### 12.2 三個 b 段 tool 的最小化 schema
- **`start_research_session`**：只收 `topic_brief`（限 40-80 字，禁 URL/貨幣/email/連續金額數字）+ `region_code`(enum TW|HK|SG|JP|KR|US|EU|GLOBAL) + `scope`(enum company|single_market|cross_market|product_category|regulatory) + `audience_type` + `depth`。回 `session_id` + `missing_fields` + `next_question_options`。**不回顯用戶貼的原文**。
- **`confirm_scope`**：只收 `session_id` + 選項 patch；`timeframe` 改 enum（`last_90d|last_1y|last_3y|current_cycle|open`）；tool arg 一律用代碼，中文只在回覆/UI 顯示。**不每次傳整包 contract**。
- **`submit_to_research_pipeline`**：★ **整個設計最關鍵的一刀** — payload 最小化到 `{ session_id, confirm_contract_version, notify_email_opt_in }`。**完整 contract 絕不放進 submit tool args**（ChatGPT safety filter 看得到 tool args，塞整包 contract 仍會被攔）。b server 從 D1 讀已存的 contract，**server-to-server POST 到 a 段**。

### 12.3 contract 累積方式（修正 §5/§7）
contract 在 **b server D1 逐步累積**（每次 grill 把選項 patch 進 D1 的 session row），**不經 tool-call 回傳給前端**。submit 時只送 `session_id`，b server 自己組 contract 打 a 段。→ contract 裡的 `sub_questions`/`seed_sources` 文字**永遠不穿過 ChatGPT tool 通道**。

### 12.4 sub_questions 顆粒度（回答「grill 多細」）
- **章節級抽象問題**，不是搜尋查詢、不是 finding 草稿。**4-7 條、每條 12-40 中文字、禁數字/貨幣/URL/百分比/引文/來源名串列**。
- ✅ 好：「健康管理服務如何改變壽險公司的價值主張？」「該公司在商品、通路與客戶經營上有哪些轉型路徑？」
- ❌ 壞：「分析 27.3 萬人、720 億步、NT$1,645 億對南山 ROI 的影響」「比較 A/B/C 三家 2024-2026 保費/EPS/RBC」
- **b 段產「研究意圖 + 章節骨架」，a 段才把每條抽象問題展開成多個含公司名/年度/貨幣/數字/URL 的 search queries**。

### 12.5 高風險內容擋 b 段外（做成 invariant）
**b 段 tool args 永不傳**：URL/domain/http、貨幣符號（$/NT$/€/¥）、密集數字（連續 4 位+/逗號數字/百分比/金額/股價）、raw excerpt/finding/引文、source 全文、PII/保單號、大段中文/PDF 貼文。

**用戶若在聊天貼 URL/含數字素材**：不回顯原文、不整理進 sub_questions、不呼叫含 URL 的 tool；回覆只說「視為候選素材，提交時只送研究範圍，來源蒐集交給後端 pipeline」。指定來源若必須保留 → out-of-band（前端 widget source box 直接 fetch 到 worker / 檔案上傳取 `source_ref_id`），tool args 只放 `source_ref_id`。

**用戶確認畫面只顯示「安全摘要」**：topic、region_code、scope、depth、章節數——不顯示 URL/金額/密集數字。

### 12.6 tool 描述用詞
description 避免「fetch URL / scrape / download / web / source_url」這類把模型導向高風險形狀的詞；改寫「建立研究任務 / 確認研究範圍 / 提交非同步研究工作」。每輪只問一個低風險選擇題，不要一次塞「topic + 10 子問題 + sources + notes」。

> 我的 review（Claude）：codex 建議幾乎全採納，**12.2/12.3 的「submit 只傳 session_id、contract 存 D1 server-to-server」是對原 §5/§7 的關鍵強化**（原設計沒講清 contract 怎麼不穿前端）。唯一保留：12.5 的「widget source box / file_id」依賴 ChatGPT Apps SDK 的 UI widget，我們現在是純 MCP connector 無 widget——seed_sources 先簡化成「用戶口頭講、a 段自己找」，真要指定 URL 的 out-of-band 上傳留待之後。`topic_brief` 禁「連續數字」要放寬到允許年份（2026）但禁金額/統計。

---

## 13. a 段研究品質契約（產出標準，萃取自原 grill-me-first 設計）

> 用戶要求：a 段要用「高標準研究報告的要求條件」產出，報告才有價值。以下萃取自 vip-research-skill.md（grill-me-first + 抓公開資料集原則）+ mcp.ts checkReportQuality（6 gate）。**搬到 a 段後，這些從「chat 撞 gate → grill 用戶」變成「a 段自我審查 → 自己修到達標 → 才回流」的全自動迴圈。**

### 13.1 Block 條件（不達標 a 段不回流，自己修重跑）
1. **深度達標**：body ≥ depth threshold（A 500 / B 1500 / C 2500 字），反 reduce-to-pass（`body_too_thin`）。
2. **footnote 完整**：內文每個 `[^N]` 都有對應 finding（`footnote_orphan`）。
3. **核心量化結論有第一手實數**（用戶 2026-06-01 明令）：費用金額/占比/人均值/年齡疾病分層/時序趨勢等核心量化事實，必須**抓公開資料集抓實際數值**（如「113 年 65+ 每人年醫療費 79,831 點」），**不能只說「某署有此統計」**。範本 `reference/aged-medical-cost-dataset/`（download.sh 抓原始檔 + extract.py 可復現解析）。
4. **全量化溯源**：每個量化數字 / 競品名 / 公司動態 / 新聞事件都對應一個 finding（強制 source_url）+ 內文 `[^N]`。防 LLM 幻覺數據（編造市佔率/保費 = 業內嗤笑 + 合規風險）。
5. **第一手來源**：source_url 是官方原始連結（非二手新聞、非前序報告），每數字標年份 + 單位。

### 13.2 Warn 條件（a 段盡量修，修不掉寫進報告 caveat）
6. **多來源**：單一 source 不超過 4 個 findings（`single_source_overreliance`）。
7. **日期真實**：source_date 非 YYYY-01-01 / 12-31 placeholder（`placeholder_date`）。
8. **無冗餘 finding**：加進來的 finding 都有被內文引用（`unused_finding`）。

### 13.3 a 段自我審查迴圈（核心 — 比人工 grill 強的地方）
```
原設計（b 段人工）：chat create_report → QUALITY_GATE reject → grill 用戶 → 用戶決定修/接受
a 段（全自動）    ：P5 跑 gate → block 不過 → 自己回 P0-P4 補蒐證/擴寫/補 finding → 重跑
                   → 達標才 P6 回流；warn 修不掉 → 寫進報告「資料限制」caveat
```
- a 段不疲倦、能反覆修到過 gate → 品質下限 = 原 gate 標準，但達標率比人工 grill 高（人會接受 warn 上架，a 段會多試幾輪）。
- 複用 **paperclaw quality-gate 迴圈**（80/100 threshold + 自動 review，本來就有）。
- **迴圈上限 N 輪**（防無限迴圈）：N 輪後仍撞 block → job 標 `failed` + 原因，b 段 poll 看得到，不硬上架低品質報告。
- 「核心量化結論抓不到第一手實數」是最常見的卡點 → a 段 P0 plan 階段就要先 probe 資料源可達性（學 paperlab `probe_data_source`：抓不到的維度標灰、換角度），避免寫到 P4 才發現無實數可引。

### 13.4 contract 帶下來的品質參數
b 段 grill 收斂的 `depth`（A/B/C）決定 §13.1 條件 1 的字數門檻 + 條件 3 的數據深度要求；`scope`/`audience` 決定章節取角。**a 段照 contract 的 depth 自動套對應品質標準，不需 b 段逐項指定。**

### 13.5 達標基準線（對齊現有上架報告實測，2026-06-14 抽樣 3 篇）

現有 checkReportQuality 是 binary gate（有/無 orphan、body 字數夠不夠）。但「詳細數據 + 來源出處」要更細的量化 metric。a 段自我審查迴圈（§13.3）要跑到**對齊現有報告實測水準**，不只過 binary gate。實測台灣 38969b1c / 香港 9cd7298c / 韓國 2678b224：

| metric | 實測範圍 | **a 段達標線** | 性質 |
|---|---|---|---|
| footnote ref == def | 16/16, 15/15, 17/17 | **100%（0 orphan）** | block 硬性 |
| footnote 結構（含 URL+日期+引文類型） | 13-17 / 15-17 | **≥ 90% footnote 三者齊全** | block 硬性 |
| 量化數字點（數字+%/億/萬/點/人/歲…） | 59 / 117 / 86 | **depth C ≥ 50、且每個有 footnote 溯源** | block（價值核心）|
| 引用密度（每 footnote 撐字數） | 241 / 548 / 673 | **≤ 700 字 / footnote** | warn |
| tables | 0 / 4 / 18 | **非硬性**（model 系統性弱項，0 可上架）| 不檢 |

**來源出處統一格式**（a 段每個 finding 必須產出）：
```
[^N]: [來源標題](https://第一手URL) (YYYY-MM-DD) — news_quote|web_quote|annual_report: 原文引述摘要
```
不是裸 URL、不是「某署有此頁面」——是**可點 URL + 發布日期 + 原文引述**三者齊全。

**a 段自我審查迴圈的具體驗收**（§13.3 的「達標」= 這張表的達標線）：P5 不只跑 binary gate，還算這些 metric；量化數字點不足 / footnote 結構不齊 / 有 orphan → 回 P1-P4 補蒐證補溯源重跑。**這才是「報告有沒有價值」的可量測判準。**

---

## 14. 引擎實查與 a 段架構修正（2026-08-02）★ 取代 §6 phase machine 設計

### 14.1 引擎現況（SSH 實查 ac-2012 / ac-3090 / tencent-sv）

| 項目 | 實查結果 |
|---|---|
| **引擎 host** | **ac-2012**（100.108.115.6，7.7G RAM，工具鏈 hermes✓ codex✓ xelatex✓）|
| 服務樹 | `~/paper-job-service/`：`newarch/` = live A HTTP service（FastAPI `http_app.py` + `engine_routes.py` + Dossier 狀態機）；`paper_agent/` = **B engine**（Hermes 單一長 session，`paper_agent.harness.run_paper_job(contract, data_dir, run_dir) → PaperJobResult`）|
| B worker | `BUILD_SPEC_BWORKER.md` + `B_WORKER_DONE.md` 在 → **B-backed worker 已落地**：HTTP 面（`POST /jobs`、`GET /v2/jobs/{id}/status`、`/v2/jobs/{id}/paper`）與 Dossier status contract 不變，worker 換成 B engine |
| Hermes | `~/.local/bin/hermes`，native `--skills` / `--continue`；免費模型走 `127.0.0.1:8898` gateway（big-pickle）+ `zen-shim.service`（Zen 免費模型 auth-strip proxy）|
| 部署樹 | `~/engine-live-newarch/`（含 cloudflared → 對外域名走 tunnel）；port 8090 綁 Tailscale IP |
| ac-3090 | 6/15 清查建議的「引擎搬 ac-3090」**未執行**（只有 paperbench + codex）。本案不依賴搬遷 |
| tencent-sv | ⚠️ SSH host key 變更 + publickey 拒絕 — 連不上，scholar-pipeline 現況不明，**需使用者確認**（可能與 GemGate 除役/VM 重建有關）|

### 14.2 a 段架構修正：bounded Hermes session，不是 phase machine

原 §6 的 P0-P7 paperclaw phase 集合 = 「Python 擁有 loop、每 phase 一發子呼叫」——**正是 B_SPEC 判死的 A 架構**（fragmented stateless dispatch）。修正為 Paper Lab V3.2 定案形狀：

```
thin harness（Python，deterministic control plane）
  ├── 收 contract → 建 run_dir + Dossier → 起 ONE Hermes session
  ├── Hermes session（bounded semantic worker）自己擁有研究 loop：
  │     讀 contract + skills → 展開查詢計畫（原 P0）→ 讀 KB articles + 打 Exa（原 P1/P2）
  │     → 累積 findings（強制 source_url）→ 逐章寫作（原 P4）→ 自我檢查、自己修
  ├── canonical validators（deterministic，session 之外）：§13.1 block 條件 + §13.5 metrics
  │     → fail → 帶 gate report 回 session 修（≤ N 輪）→ 仍 fail → blocked + TG 問使用者
  └── pass → POST /complete 回流上架 → notify
```

分工鐵則（V3.2）：**Harness 管邊界、Hermes 管推進、validator 管真偽**——Hermes 不能當 gate 事實的證人（不能自寫 quality 報告宣稱達標），§13.5 metrics 一律由 harness 端 deterministic script 算。

### 14.3 對接需要的具體改動（B engine 側）

| # | 改動 | 說明 |
|---|---|---|
| E1 | job server 加 **lane 路由** | contract `task_type: insurance_research \| insurance_monthly_deep` → 選 insurance harness 入口（paper lane 不動）。**contract 必帶 `lane_version`**（V2 lane-mismatch 教訓，§11.2）|
| E2 | insurance harness 入口 | `run_insurance_job(contract, run_dir)`：類 `run_paper_job`，產出 = `report.md` + `findings.json`（非 PDF）；Dossier status contract 沿用 |
| E3 | insurance skills | Hermes skill 版的研究紀律（= §13 品質契約 + vip-research-skill 精髓）裝進 skills registry |
| E4 | validators | §13.1/§13.5 的 deterministic 實作（跑在 harness，讀 artifacts 算 metrics）|
| E5 | egress | 引擎需能打 Exa API + 保險 KB 公開 search API + 第一手來源網站 |
| E6 | 回流 client | 引擎端 POST 保險 worker `/api/research-pipeline/complete?key=`（§7 不變）|

b 段（insurance-kb worker）改動照原 §7/§9/§12 不變。

### 14.4 開放問題更新（承 §11）

- §11.1 model 選型：B engine 免費 big-pickle 驅動論文可行，但保險 depth=C 品質敏感（§13.5 量化門檻高）→ **先免費層跑 E2E，metrics 不達標再升 model tier**，不預先付費
- §11.2 recipe 註冊：已解 — 即 §14.3 E1 lane 路由
- §11.4 舊路徑退場：chat 端直接 create_report 保留當 fallback（原 §10 Phase 1 設計不變）

## 15. 月度深度分析 lane（2026-08-02 新增）

- REQ-M1：`task_type: insurance_monthly_deep`，**無 grill**——b server 排程（每月 5 號，月蒸餾 + wiki 上線後）自動組 contract：從當月 monthly wiki 各 region 挑熱點主題（重點段落密度 top N），生成 sub_questions
- REQ-M2：走同一條 a 段 lane 與同一套 §13 品質契約；depth 預設 B（月度節奏，C 留給 VIP 點題）
- REQ-M3：產出進 reports D1，`type` 標 `monthly_deep` 與 VIP 報告區隔；上架後 TG 通知使用者
- 選題參數（每月幾篇、哪些 region 優先）：待第一輪跑完看品質再定，先 hardcode 2 篇/月試跑

## 16. test_matrix（spec-tdd-chain — 本表即 TDD RED 清單）

| REQ | 內容（可判定句） | 驗證方式 | 測試類型 | 落點 |
|---|---|---|---|---|
| REQ-B1 | b 段 tool args 不含 URL/貨幣符號/連續 4 位數字（§12.5） | arg validator 對禁樣式 0 通過、合法樣本 100 通過 | unit + invariant | CI + b server 執行期 reject |
| REQ-B2 | submit 只傳 session_id；完整 contract 不出現在任何 tool args | schema 斷言 + ring buffer 抽查無 contract 字段 | integration | CI |
| REQ-B3 | 同 session 重複 submit 不產生第二個 job | 連打 2 次 POST，a 段 job 數 = 1 | integration | CI |
| REQ-A1 | 引擎收 contract 建 job，status 可 poll 到 running/done/blocked/failed | stub contract E2E 走完狀態機 | integration | CI（stub）+ live E2E |
| INV-1 | contract 無 `lane_version` 或版本不符 → 引擎拒收（非默默進錯 lane） | 缺欄/錯版 contract → 4xx | unit + integration | CI |
| INV-2 | 每筆 finding 必有 source_url，且為第一手來源格式（§13.5） | findings.json schema 掃描 0 違規 | invariant | CI + a 段 gate 每輪跑 |
| INV-3 | 報告內文公司名 canonical 一致 | entity-name-guard watchlist 掃描 0 違規 | invariant | a 段 gate + 月度 audit |
| REQ-A2 | §13.1 block 條件全過才回流（body 門檻/footnote 0 orphan/量化點 ≥50 且全溯源） | validators 對 3 篇基準報告（§13.5 實測）全綠、對降級樣本正確 block | invariant（fixture truth-table） | CI + a 段 gate |
| REQ-A3 | gate N 輪不過 → status=blocked + TG 通知使用者（不硬上架） | 塞不可能達標 contract → blocked + 收到 TG | integration + detector | CI（mock TG）+ **生產告警通路 live 測一次** |
| INV-4 | job 卡 running > TTL → reconcile 標 blocked + 告警 | kill worker 途中 → TTL 後告警 | detector | **生產**（Dossier sweep）|
| REQ-P1 | 同 job_id 重複 POST /complete 不 double createReport | 連打 2 次 → D1 report 數 = 1 | integration | CI |
| REQ-P2 | 上架後 D1/R2/git 三寫一致（report_id 三處可讀且內容同 hash） | 真值源往返：上架 → 三端讀回比對 | 真值源往返 | CI + live E2E |
| REQ-M1 | 每月 5 號自動產 monthly_deep contract 並提交 | 排程 dry-run 產出 contract schema 合法 | integration | CI + 生產（首月人工核）|
| REQ-N1 | completed/blocked 都發 TG（含 report URL 或 blocked 原因） | 兩種終態各觸發一次 | integration | CI（mock）+ live 首跑驗收 |
| — | §12 intake 防攔截實效（ChatGPT 端不被 filter 攔） | **CI 測不了**（OpenAI 平台層行為） | — | **生產觀測**：submit 成功率 ring buffer，攔截即出現在 b server log 缺口 |

缺列理由：§13.2 warn 條件（多來源/日期真實/冗餘 finding）不進 RED 清單——warn 不擋回流，由 gate report 記錄即可。

## 17. 對齊補充（2026-08-02 第二輪，使用者拍板）

### 17.1 submit 觸發流程（REQ-B4）

grill 收斂（欄位齊 + probe 完成）→ server 回「contract ready + 安全摘要」→ chat 向使用者顯示摘要並問確認 → **使用者明確確認後** chat 才呼叫 `submit_to_research_pipeline(session_id)`。

- **機械閘不靠 chat 自律**（6/5 雙週報實證軟防線擋不住）：server 端 session 狀態必須 = `contract_complete` 才接受 submit，否則 **409**。tool description 另寫「僅在使用者明確確認後呼叫」當第一層，但正確性由 state gate 保證
- 提交後回 job_id；進度查詢走 `check_research_job`；完成/blocked 走 TG 通知

### 17.2 grill 期 data probe（REQ-B5 / INV-5）

- **probe 由 b server 端執行**：grill 過程 server 對各數據維度打 KB search API + Exa 輕量探測第一手來源可達性。chat tool args 只帶 `session_id` + 維度代碼；回顯只有 `available|weak|missing` 三態
- **contract 零實際數據**：只帶 `data_probe: [{dimension, status, source_hint}]` 旗標。實際數字全部是 engine 段蒐證的產出，不是 grill 的輸入
- **missing 維度在 grill 期攤牌**：probe 標灰 → 問使用者「換角度還是接受缺口」，grill 期收斂，engine 不白跑（直接消解 §13.3 最常見卡點）

### 17.3 test_matrix 補列

| REQ | 內容（可判定句） | 驗證方式 | 測試類型 | 落點 |
|---|---|---|---|---|
| REQ-B4 | session 非 `contract_complete` 狀態的 submit 一律 409 | 各前置狀態打 submit → 只有 complete 通過 | unit + integration | CI + b server 執行期 |
| REQ-B5 | probe 由 server 執行；chat tool args 無數據內容（只 session_id + 維度 enum） | schema 斷言 + probe 觸發後 ring buffer 無數據字段 | integration | CI |
| INV-5 | contract JSON 不含實際數據（金額/統計值/引文），只含 probe 三態旗標 | contract serializer 對禁樣式掃描 0 命中 | invariant | CI + submit 前 server 端斷言 |

## 關聯
- 範本：paperlab-kb/workers/src/pipeline.ts（handoff state machine）、ac-2012 `~/paper-job-service/paper_agent/`（B engine harness）、`BUILD_SPEC_BWORKER.md`（worker swap contract）
- 攔截調查：knowledge-base tech/agent/2026-06-14-ChatGPT-OpenAI-safety-filter-攔截保險MCP工具呼叫-調查.md
- 架構依據：knowledge-base tech/agent/2026-06-26-Paper-Lab-V3.2工程案例.md（bounded Hermes + validator-owned truth）、2026-06-01-Hermes-執行管線-SDD.md
- 複用 pattern：reference_admin-test-endpoint-pattern（secret-key endpoint）、現有 SPEC.md §7 MCP tools / §12 storage triple-write
