# 每週補譯契約與維運

## 根因與修復範圍

2026-10-10 Codex 對話「查詢執行紀錄」
（01a0fc06-c1f9-7413-afe7-98a80f4478c2）先啟用每週排程，依賴的補譯程式
卻只留在未提交的 `/private/tmp/insurance-kb-translation-retry`。
同一對話後來已指出：把操作狀態放入文章會製造多餘 revision，舊資料也沒有可靠 pending。
後續完成的是一次性內容修補，沒有交付排程依賴。2026-11-27 回查時該暫存目錄已不存在。
2026-11-23 排程又先被共用開發工作區的未提交變更擋住。

本次修復提供真正的 pending/apply/verify CLI、獨立佇列、PR 驗證與 main push 發布入口。
未授權時不合併、不部署；基礎 PR 合併前排程仍須回報等待基礎流程，不得宣稱補譯成功。
每月 Wiki 排程維持獨立。每日 crawl 的 Cloud 備援依本次後續使用者授權，見下節。

## 來源與狀態契約

- `index/translation-queue.json` schema_version=1，entries 以 UID 為鍵。
- 每項有 `translation_state: {title, summary}`、`expected_revision_id`、`source_hash`。
- 只認 `pending`；成功為 `completed`，人工審核不需翻譯的標題為 `not_required`。
- crawl 在嘗試翻譯前標記欄位 pending；回應有該欄位的非空文字才記 completed。
  provider 缺失、回應缺列、缺欄位與額度耗盡都保留 pending。
- 操作狀態在 index 儲存後寫入獨立佇列，失敗向上拋出並阻止 workflow 提交發布。
  `_translation_state` 不進文章內容，不影響文章雜湊。
- 不根據標題相等、語言推測或空摘要自動標記歷史文章。
  **初始空佇列不代表歷史漏譯為零**；本次不捏造歷史 pending。歷史補建須有逐 UID 證據並獨立審核。

## 每週審核

先記錄原工作區狀態，從最新 origin/main 建立全新、乾淨、獨立工作區。
原工作區有變更不影響此隔離流程；不得 stash、清理、重設或把那些變更帶入補譯。
GitHub 不可用、已有未合併補譯 PR、MonthlyStore 校驗失敗或基礎流程不齊全則停止並回報。

```sh
python -m src.translation_backfill pending --limit 20 --offset 0
python -m src.translation_backfill pending --limit 20 --offset 20
```

持續 offset += 20，直到 `page_count == 0`。某頁可能全部 skipped 而 items 為空，
這時不能提前結束。所有頁面的 base_snapshot_id 與 queue_hash 必須相同；寫入前讀完原始佇列。
只有 revision 和 source_hash 都符合的項目可審核；過期項目列 skipped，不自動重新綁版本。

只使用保存的 title_en、source_excerpt。摘要來源不足就維持 pending，不能猜測。
CLI 對摘要來源設 20 字元最低門檻，但長度不是事實證據，Codex 仍須逐句審核。

合成單一 `repairs/translation-batch-YYYYMMDD-HHMMSS.json`：

- schema_version=1、base_snapshot_id、base_queue_hash、updates 陣列。
- 每項必有 uid、expected_revision_id。
- 完成的欄位使用 title_status/summary_status=`completed` 與 title_zh/summary_zh。
- 標題 not_required 不附 title_zh；未審核欄位完全省略。
- 其他欄位一律拒絕，尤其 UID、title_en、日期、URL、分類與來源節錄。

```sh
python -m src.translation_backfill apply --patch repairs/translation-batch-YYYYMMDD-HHMMSS.json
python -m src.translation_backfill verify --patch repairs/translation-batch-YYYYMMDD-HHMMSS.json
python build_frontend_data.py
python build_wiki_json.py
AGENT_INDEX_SYNC_PLAN=repairs/agent-index-sync-YYYYMMDD-HHMMSS.json python -m src.agent_publication
python -m pytest tests -q
python -m src.publication_check
git diff --check
```

日期佔位須換成真實批次時間。套用會保存不可變的原佇列快照，先驗證整批再寫入。
原文與未審核欄位保持不變；只改狀態時文章 revision 不變。
若文章已寫入但佇列寫入中斷，同一 patch 可重跑，必須是完全相符的結果才允許恢復。
index/ 被 gitignore 忽略；提交時須明確 force-add 本批新的 queue snapshot 與資料物件，
不可修改 ignore 規則或加入其他資料。初始 queue 檔由基礎 PR 追蹤後，crawl 的 git add -A 會保存其更新。

## PR 與發布

資料批次 PR 僅允許 index、前端/Agent 衍生 JSON、單一批次與同時間戳 D1 plan。
不可改程式、workflow、既有不可變物件或刪除檔案。驗證實際 Git base 的資料及佇列 hash，
整份文章集合只能有審核指定的 title/summary 變更，D1 plan 必須精確相符且 deletes 為空。
若 crawl 已推進 main，重新以新 base 審核，不把過期 patch 硬套上去。

`.github/workflows/translation-backfill.yml` 在 PR 執行測試、驗證、重建比對。
失敗由獨立 runner 通報 ops-inbox；不把通知憑證交給 PR 程式。
合併後 `release.yml` 只因新增 translation-batch 路徑觸發，固定事件 SHA，
驗證仍是 main 最新版本後依序發布 Pages、驗證線上快照、套用既有 D1 batch plan。
不自動部署 Worker。重複同步沿用既有快照前置條件；409 或發布失敗保留 plan 並告警，不能跳過版本檢查。

驗收涵蓋：多頁、空頁、全頁 skipped、缺 queue、缺來源、重複 UID、過期 snapshot/revision、
非法欄位、部分欄位完成、狀態-only、不相關資料變動、重放、寫入中斷、D1 delete/錯誤 payload。
測試中的文章與 Git repo 均為 **Synthetic for testing only**，不代表正式資料已補譯。

## 2026-11-27 外部 API 使用查核

程式基準：`63497c9a5f71ce4c371461f7025219fe65b0cbe1` 的 src/classifier.py。
供應商為 Groq（api.groq.com）與 Gemini（generativelanguage.googleapis.com）。
Groq 配置四個模型，但本次抽查兩輪只剩 openai/gpt-oss-120b 在 live catalog；
Gemini 順序為 gemini-flash-lite-latest、gemini-flash-latest、gemini-3.1-flash-lite。
模型名稱中的 openai 不代表呼叫 OpenAI API。GitHub Models 已自 cascade 移除。

以下是完整讀取指定 run log 後統計的 chat/completions HTTP 紀錄，不是帳單或逐篇品質驗證：

| 台灣時間 / run | Groq | Gemini | 結果 |
|---|---|---|---|
| 11/27 08:30 / [45917057592](https://github.com/ai-cooperation/insurance-kb-v2/actions/runs/45917057592) | 2×200、1×429 | 50×200 | 256 篇走完分類階段 |
| 11/26 20:30 / [45820200457](https://github.com/ai-cooperation/insurance-kb-v2/actions/runs/45820200457) | 2×200、1×429 | 13×200、3×503 | 397 篇中從第 76–80 篇耗盡備援；log 記 65/80 批失敗，ops-inbox #49 已收到告警 |
| 11/21 10:11 / [44854456781](https://github.com/ai-cooperation/insurance-kb-v2/actions/runs/44854456781) | 1×200 | 43×200、2×503 | 503 個候選；也有 HTTP 200 後 JSON 無法解析，後來耗盡備援 |
| 11/21 12:40 / [44867260020](https://github.com/ai-cooperation/insurance-kb-v2/actions/runs/44867260020) | 無 chat/completions 紀錄 | 無 chat/completions 紀錄 | 讀 599 筆人工譯文檔、命中 589 筆，其餘 10 筆先前已套用 |

Groq 429 明示 TPM=8000；不是每次都能推定為每日額度耗盡。
上述基準的 classifier 沒有持久化 response.usage，無法從這些歷史 log 得出總 token 數或費用。
GitHub workflow 成功只代表整條 job 結束；不保證每篇有譯文，這正是獨立 pending 佇列要補上的缺口。

## 獨立 Cloud 專案與啟用門檻

2026-11-27 改採使用者提供的 meeting-capture-studio Cloud 原生端點架構
（[驗收 run 46003781573](https://github.com/ai-cooperation/meeting-capture-studio/actions/runs/46003781573)，
程式版本 3c9f3a496b561c1aa1a1e0bd03e62737d90c90a2）。Insurance KB 使用自己的專案與身分：

- 專案 `gen-lang-client-0158989334`（Insurance KB Translation），編號 `419553420544`。
- 帳務帳戶 `011655-216503-7ECC9A`，billingEnabled=true；共用已領取抵用額的帳戶。
- 服務帳號 `insurance-kb-translate@gen-lang-client-0158989334.iam.gserviceaccount.com`。
- 自訂角色 `insuranceKbTranslate` 只有 `aiplatform.endpoints.predict`、`serviceusage.services.use`。
- WIF provider：`projects/419553420544/locations/global/workloadIdentityPools/insurance-kb-github/providers/repo`。
  限 GitHub repo ID `1213606151`、owner ID `258149792`、main 分支，及 crawl/reclassify/
  translation-cloud-smoke 三個指定 workflow。沒有服務帳號私鑰或長期 Cloud API key。
- 預算 `34e5b828-27f9-46f5-ba82-75a6c2f98fe6`：本專案每月 NT$100、抵免前成本，
  50%/90%/100% 以預設帳務管理員／使用者電子郵件提醒。已讀回設定，未驗證郵件實際送達；不是停機上限。

每日流程保留 Groq → Gemini，選配 Cloud 在最後。原生 Cloud 端點為
`aiplatform.googleapis.com/v1/projects/.../locations/global/publishers/google/models/...:generateContent`。
首次整合時 GitHub 變數 `VERTEX_TRANSLATION_ENABLED=false` 已讀回確認，先保持停用。
`VERTEX_PROJECT_ID`、`VERTEX_MODEL`、`GCP_WORKLOAD_IDENTITY_PROVIDER`、`GCP_VERTEX_SERVICE_ACCOUNT`
已設定，但只有 enable=true 才進入正式流程。每週 Codex 補譯仍不呼叫任何模型 API。

crawl/reclassify 使用可更新的 WIF 憑證，避免長工作超過一小時後權杖失效。
crawl 的 git add 排除 `gha-creds-*.json`；auth action 在結束時清理暫存憑證。
獨立手動 smoke workflow 只在 main 執行，以短效權杖跑兩筆合成資料，模擬主層 429 後測 Cloud，
不改文章、不寫 D1，失敗通知既有 ops-inbox。**Insurance KB 的 GitHub OIDC 實際交換與呼叫仍待驗收**；
本次本機呼叫用登入者短效 OAuth，不能拿來證明服務帳號的 OIDC 已通過。

### 首輪驗收未通過品質門檻（歷史紀錄）

原始輸出與監控查回保存在 `validation/cloud-translation-20261127.json`。
三輪、每輪兩個合成案例，共六次 HTTP 200、13,099 tokens；Cloud Monitoring 數字相符。
四次 3.5 Flash-Lite 為 8,701 tokens，兩次 3.8 Flash 為 4,398 tokens。
這證明原生 Cloud 呼叫路徑可用，不代表翻譯正確或帳務抵免已核銷。

- 第一輪舊 prompt 要求固定 80 字，輸出加入未提供的跨國業務／監管背景，且把 Synthetic 譯為「綜合」。
- 第二輪限制只寫來源事實、最多 80 字，仍將 Synthetic 譯為「綜合」、架空譯為「架構」。
  當時七項機械檢查全過，但人工審核判定失敗，因此擴充檢查；不採用早期的全過結果。
- 第三輪較強模型仍將 Synthetic 譯為「綜合」。兩輪新 prompt 也將未明示金額的 claims 收窄成「理賠金額」。

機械檢查只是這兩個案例的回歸條件，不能證明一般新聞品質。沒有把樣本寫回文章。
該輪停止追加試跑並保持 enable=false，後續需解決上述錯譯、人工審核新樣本，
並在合併後以 GitHub OIDC 跑 smoke 通過，才能另行啟用。程式測試通過不等於此品質門檻通過。

此 Cloud 路徑已在沒有購買 AI Studio NT$150 預付點數的情況下成功呼叫；
先前 AI Studio 的 Prepay 畫面不是領取抵用額的必要付款。沒有執行付款。
每月訂閱抵用額屬共用帳務帳戶，不是每把 key 各有一份；實際抵扣仍須以 Cloud Billing 查回為準。
官方資格：[Google Developer Program FAQ](https://developers.google.com/profile/help/faq)。

### 使用者要求繼續後的修正與驗收

2026-11-27 後續紀錄見 `validation/cloud-translation-followup-20261127.json`，保留中途失敗輸出，
不覆寫首輪紀錄。修正兩個可觀察缺口：

- `_build_llm_prompt` 原本將標題、來源、節錄用連字號串在同一行；實測模型將 unknown
  和節錄一起放入 title_zh。改為具名 JSON 欄位，明定標題只譯 title、摘要只用 source_excerpt。
- 沿用既有術語表補上 synthetic/comprehensive、架空/架構與 claims 度量差異；
  明定摘要可獨立閱讀，必須保留來源的虛構、假設、否定與測試性質。沒有在輸出端硬改答案。

最後本機回歸兩筆案例通過 12 項檢查及人工語意審核；另一次批次測三筆未用來調整提示的
英／日／韓合成案例，人工核對金額、否定、地點、考慮中／未定日期、多篇對齊均符合來源。
這五筆共三次 Cloud 呼叫、7,988 tokens，只能證明該樣本範圍，不能宣稱未來翻譯零錯誤。

啟用順序：PR CI 通過 → 合併 main → 執行 `translation-cloud-smoke.yml` → 人工查看 artifact
及查回 Cloud Monitoring → 才設 `VERTEX_TRANSLATION_ENABLED=true`。手動 smoke 在開關 false 時
也可執行，且不呼叫真實主層、不改正式文章。若失敗，保持 false；啟用後要停用也只需將此變數設 false。
該開關僅控制每日／手動外部 API 備援，週一 Codex 離線補譯規則不變。

新增 `translation_usage` JSON log：provider、實際模型、文章數、prompt/completion/total tokens。
每天 crawl 與手動 reclassify 都在解析模型輸出前記錄，因此無效 JSON 仍計入觀測用量。
缺 usage 保持 null；HTTP 失敗沿用狀態碼 log，不能假設零費用。這些不是歷史帳單回填，
也沒有設定或宣稱費用硬上限；紀錄保存期依 GitHub Actions log retention。
