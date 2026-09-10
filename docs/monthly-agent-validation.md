# 月分片與 Agent 完整讀取交付核對

日期：2026-09-10。狀態：已推送 main，Pages 與 Worker 已部署並驗證。下方原始實作紀錄保留當時驗證範圍；最新發布結果見本節。

## 正式發布結果（2026-09-10 23:30 Asia/Taipei）

- 程式版本：`cdc2ddc4ea700855ebc64646bcb231c90bd52541`（主要修正 `9347ade`）。
- Pages 發布：[GitHub Actions 34495620427](https://github.com/ai-cooperation/insurance-kb-v2/actions/runs/34495620427)，結論 success。
- Pages 版本：`01b996c8`，正式網址、自動網域、版本網址皆 HTTP 200。
- Worker 版本：`055676d4-23ef-4ba5-b060-8a2739eb58e7`；公開 `/mcp/manifest` HTTP 200、版本 0.4.0，新增工具已出現；未登入 MCP 呼叫維持 HTTP 401。
- 雲端：33 項 Python 測試、15 項 Worker 測試、型別檢查與建置通過；61,078 筆真實資料全量遍歷 633 次分頁，398 頁 Wiki 可列舉。
- Linux Chromium：建置預覽、正式網址、Pages 網址各驗 375／768／1280，共 9 張截图；標題與頁面無橫向溢出，文章數與新聞卡片可載入，CSS／JS 版本與建置一致。證據附於該次 Actions artifact。
- 線上資料：兩個 manifest snapshot 與本機一致；最新、最舊、最大文章分片及兩篇 Wiki（共 5 個物件）的 HTTP 200／SHA-256 均通過。
- 此次未取用使用者 MCP token，因此沒有宣稱「線上已登入 MCP 工具全量遍歷」；全量讀取是相同正式 reader 對凍結發布資料的離線／CI 驗證。
- 未補抓新聞、未呼叫 LLM；最新來源日期仍是 2026-09-01。既有每日兩次爬蟲排程未變更。

發布憑證分工：現有 GitHub `CLOUDFLARE_API_TOKEN` 只有 Pages 權限；`release.yml` 的 `deploy_worker` 預設 false。
本次 Worker 透過使用者授權的 Wrangler OAuth profile `insurance-kb-alan` 部署，未擴權或替換 GitHub secret。
日後若同時發布兩者，先等 Pages workflow success 並執行 `python -m src.publication_check --live`，
再於 workers/ 使用 `wrangler deploy --keep-vars --profile insurance-kb-alan`，最後核對公開 MCP 版本。
只有另備妥具 Worker 權限的 CI 憑證時，才可選 `deploy_worker=true`。

前兩次發布在寫入正式環境前被擋下：Worker token 權限不足、瀏覽器 network-idle 等待逾時；
後者改為驗證實際文章數與卡片已渲染，沒有略過資料、版本或畫面檢查。失敗通知依既有 Telegram 設定發送。
若需人工回復程式版本，部署前 Worker 版本為 `072210bf-f1e8-4748-9d76-4d6b2129926f`；
不應先回退／刪除新版 Pages 分片，以免已發出的 Agent cursor 或引用失去來源。

工作副本：`/Users/user/projects/insurance-kb-v2-monthly-agent`
分支：`codex/monthly-agent-integrity`
基準：`ffd8beb40309023c741110acd588b0531544cf7f`（遠端 main 的 2026-09-01 資料）
原工作目錄 `/Users/user/projects/insurance-kb-v2` 未修改。

## 根因與修正範圍

原後端 `index/master-index.json` 是 104,744,447 bytes 的全歷史陣列；
前端雖已按月，但後端寫入仍會增加同一個 Git blob，導致後續 push 超限。
現在主索引僅保存月分片目錄；各 Python 讀寫入口改走同一儲存層。
不遷移 D1/R2、不更動 Chat 搜尋或卡片載入介面。

Agent 三個缺口：

- 資料範圍：不再只依賴最近 30 天的 Chat 相容檔；目錄列出實際月份，支援日期範圍及全歷史分頁。
- 證據內容：預覽與完整保存紀錄分離；用 article_id + revision_id + snapshot_id 讀原保存版本，長內容明示分段。
- Wiki：直接發布保存的 Markdown 頁面與來源資訊，不再用錯誤的月份鍵解讀瀏覽器 wiki.json。

新增資料保留原始摘錄、抓取時間及摘要類型；舊資料不虛構抓取時間或原文。
新月報記錄實際選用文章、版本、送入模型的截短摘要及提示版本。
來源或候選集合變更會標示 stale；生成失敗不覆寫上一版。
段落雜湊與來源對應是追溯基礎，不是「已驗證事實」或完整 Chunk Revision 編輯引擎。

## 全量核對結果

| 項目 | 結果 |
| --- | --- |
| 後端原紀錄 | 101,805 筆，所有原有欄位逐筆一致 |
| 可見紀錄 | 61,078 筆；排除規則與既有網站一致 |
| 後端主索引 | 44,637 bytes |
| 後端月分片 | 197 片，最大 2,097,150 bytes（上限 2 MiB） |
| Agent 資料 | 306 片，單片上限 512 KiB |
| 真實 Agent 全量遍歷 | 633 次分頁，61,078 個 ID 無遺漏、無重複 |
| Wiki 目錄 | 398 頁，全部可列舉；兩頁完整內容抽驗 |
| 完整文章內容 | Python 發布檢查逐筆對比全部保存欄位；TypeScript 另抽驗三筆，包含最長保存紀錄 |
| 原前端輸出 | 124 個月檔、文章目錄、stats、Chat 相容 articles.json 重建後 Git diff 為空 |

124 是來源日期的月份分桶，不是網站成立 124 個月；歷史日期未在本次重新驗真。
398 篇既有 Wiki 的來源鏈均為 unknown；沒有把舊文章 URL 猜配成歷史生成證據。
瀏覽器 Wiki 重建包含已存在但原發布檔漏掉的 2026-08，頁數由 321 變成 398；沒有呼叫模型重寫這些文章。

原始完整紀錄去除新增 lineage 後的 canonical SHA-256：
`540c9e6897892156eae6f30a969880fd85bf8591bdbcb7c65a2b9b6865998e80`

後端 snapshot：`517582a8801b4633db174dfa39728c642f35bec917ce44bde61138945e7d69ae`

Agent snapshot：`c188b255f3b0320548ad0403485b42b5cfec8b4078c57e57f7d4eb4915902deb`

## 可重跑驗收

在工作副本根目錄執行（Python 需 requirements.txt、pytest、pytest-cov）：

```sh
python -m pytest tests --cov=src.monthly_store --cov=src.agent_publication --cov=src.publication_check
python -m src.publication_check
python scripts/migrate_monthly_index.py
```

Python 30 項通過，三個新增核心模組合計 coverage 87%。
遷移已完成時 migration 指令是驗證後的 no-op，不會再產生新版本。

在 workers/ 執行：

```sh
npm run typecheck
AGENT_PUBLICATION_DIR=../frontend/public/data/agent npm test
```

涵蓋跨月、無命中仍接續、同片中途分頁、快照固定、帳號隔離、損毀/缺片、版本不符、長文字、Wiki 與 MCP 工具目錄。
預設 npm test 會跳過真實資料測試；上述環境變數才會執行全量遍歷。
frontend/ 的 `npm run build` 通過；保留既有大型 JavaScript bundle 警告，不擴大到 UI 優化。

## 發布與剩餘限制

1. Review 後需包含新 index/objects、index/snapshots（index/ 原本被 ignore，工作流已明確 force-add）。
2. 先發布新 Pages 資料，核對公開 snapshot，再發布 MCP Worker 0.4.0，讓客戶端重新取得工具規格。
3. crawl / distill / reclassify 已加入發布完整性、容量及發布後版本檢查，失敗接既有 Telegram 通知。
4. 本回合未呼叫線上爬蟲、LLM、Telegram，未動正式服務。最新來源日期仍是 2026-09-01；停更期間資料尚未補抓。
5. Git 歷史版本會增加儲存量。15,000 public files、20 MiB public asset、50 MiB staged blob 為提前阻擋門檻，不代表無限容量；不可刪除舊引用目標來硬過檢查。
6. 自訂 MCP 程式必須支援 next_cursor / next_offset；舊版只讀第一頁的程式不會自動變完整。前端及 Chat 原契約不變。
7. 目前仍需序列化寫入；共用 Actions concurrency lock 已保留。本機同時跑多個寫入器不在支援範圍。

細部契約見同目錄 `agent-data-contract.md`。本次未導入自動 Wiki 圖譜、向量/混合搜尋、長期記憶或新的資料庫。
