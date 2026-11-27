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
每月 Wiki 排程維持獨立。每日 crawl 的 Gemini key 切換依本次後續使用者授權，見下節。

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
目前 classifier 沒有持久化 response.usage，無法從這些 log 得出總 token 數或費用。
GitHub workflow 成功只代表整條 job 結束；不保證每篇有譯文，這正是獨立 pending 佇列要補上的缺口。

## Gemini 抵用額專案切換

2026-11-27 使用者選擇沿用 Gemini Developer API，新增綁定抵用額專案的 key。
在 GitHub Actions repository secret 設定 `GEMINI_CLOUD_API_KEY`；程式設定後順序為
gemini-cloud → Groq → 舊 Gemini。未設定時沿用原順序，不把缺憑證當成功。
不讀取或搬運舊 secret；不能把 key 貼進程式、測試、log 或聊天。

端點仍是 `generativelanguage.googleapis.com/v1beta/openai/`，沒有增加 Vertex AI、ADC
或地端模型。每週 Codex 待補譯仍不呼叫任何模型 API。每月 US$10 是帳務抵用額，
不是每把 key 各自的額度，也不是用量硬上限；需確認 key 所屬專案連到已領取額度的帳務帳戶。
官方資格與預付條件：[Google Developer Program FAQ](https://developers.google.com/profile/help/faq)。
切換前需確認正確專案及以小樣本驗證，實際抵扣需以 Cloud Billing 查回為準。

新增 `translation_usage` JSON log：provider、實際模型、文章數、prompt/completion/total tokens。
每天 crawl 與手動 reclassify 都在解析模型輸出前記錄，因此無效 JSON 仍計入觀測用量。
缺 usage 保持 null；HTTP 失敗沿用狀態碼 log，不能假設零費用。這些不是歷史帳單回填，
也沒有設定或宣稱費用上限；紀錄保存期依 GitHub Actions log retention。
