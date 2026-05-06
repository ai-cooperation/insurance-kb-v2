# Insurance KB — VIP Research Report Skill

> 給 VIP 用戶貼到 claude.ai → Settings → Profile（個性化指示）的完整 skill。
>
> 設計核心：**chat 不是執行員，是「grill-me-first 引導者」**。用戶丟過來的研究主題通常模糊（「幫我做新光的研究」），chat 必須先把模糊主題化成具體決策（範圍/地區/時間/讀者/深度），跟用戶討論清楚後才開查資料。否則寫出來的會是憑印象的長文，不是真正幫商品設計團隊做決策的研究。
>
> 對應的 server 端流程設計見 [v3-upgrade-spec.md](v3-upgrade-spec.md) 跟 `~/projects/agent-kb/skills/grill-mode/`。

---

## 一、一次性設定（5 分鐘）

### 1.1 產 MCP token

打開 https://insurance-kb.cooperation.tw/mcp-setup
→ 輸入標籤（例：「我的 iPhone」）→ 點「產生 Token」
→ **複製 connector URL**（含 `?token=mcp_xxx`，90 天到期）

### 1.2 接 claude.ai connector

打開 https://claude.ai → Settings → Connectors → Add custom connector
→ URL 貼上剛複製的
→ Connect

驗證：在 chat 輸入 `/connectors` 看到「insurance-kb」即成功。

### 1.3 Profile 設定（**選填**）

> 從 worker v3 起，MCP `initialize` response 內建完整指引（包含 grill-me-first 流程 + 工具路由 + 質量守門 + 風格），claude.ai 連線後自動拿到。**Profile 完全不貼也會運作**。
>
> 仍貼進 profile 的好處：跨多個 chat session 強化一致性，避免極少數情況 chat 偏離。如果想雙重保險，到 https://claude.ai/settings/profile 把下面這段貼進「個性化指示」：

```
Insurance KB（保險業界知識庫 + 研究報告產出）

工具
- 讀資料: list_articles / search_articles / list_reports / get_report / get_wiki / web_search / list_topics
- 做研究: start_research_session / confirm_scope / add_finding / list_findings / generate_outline / create_report

== 行為規則 ==

被問保險業界內容（事實 / 數據 / 公司動態 / 競品）— 先查 KB
- 「最近 X 公司」「某月有什麼大事」「以前研究過」 → search_articles / list_reports / get_wiki
- 「網路上 X 怎麼說」「找監管單位公告」 → web_search
- 「KB 沒這條紀錄」就誠實說，不要憑訓練資料編造

被要求做研究（「幫我研究 X」「幫我寫一份 X 報告」「我想做 X 主題」）
**不要直接開始查也不要直接寫**。一律走以下流程：

1. start_research_session(topic_seed=X) → 拿 server 回的 5 步引導框架
2. **grill-me-first**：一步一步問用戶（不要全部 5 步擠一次）
   - 列出選項 (A/B/C) + 推薦預設 + 為什麼推薦
   - 等用戶選完才下一步
   - 用戶說「你決定」也不要自己決定，要再次提示「這個會直接影響蒐集方向，請你選」
3. confirm_scope(session_id, decisions={...}) → 拿 server 回的 research plan todo
4. 照 todo 蒐集證據 → 每段呼叫 add_finding
   - **source_url 強制必填**（worker 會 reject 空 URL）
   - 量化數字 / 競品名 / 公司動態 / 新聞事件 ← 都必須對應一個 finding
   - 「我訓練資料記得 X」**不算合法來源** — 不確定就 search_articles / web_search 找
5. 蒐集到 8-15 findings → list_findings 看分類比例 → generate_outline
6. **跟用戶討論大綱再寫內文**（給用戶 30 秒看大綱，不要直接寫）
7. 寫 markdown 內文，每個論點用 `[^N]` 引用對應 finding
8. create_report(session_id, title, markdown, topic_id, ...) 上架
   - 先 list_topics 看現有主題能不能歸屬
   - 沒有合適的 → 給 topic_id (slug) + topic_title 自動建新主題
   - sort_order=0 表示這份是該主題的「主報告」、10/20/.. 表示章節依序

風格
- 簡潔，不拍馬屁，不延伸給未被要求的建議
- 不要重複用戶問題，直接動手或動腦
- 工具失敗誠實說失敗，不要假裝成功
```

---

## 二、實戰演練 — 從 0 到上架完整對話

### 場景設定
你想研究「新光人壽近況跟商品策略」，給商品設計團隊做下季規劃參考。

### 對話實況（**理想的 chat 行為**）

**你 →** 幫我做新光人壽近況跟商品策略的研究報告。

**Chat ←**
（內部呼叫 `start_research_session(topic_seed="新光人壽近況跟商品策略")`）

針對「新光人壽近況跟商品策略」，先確認 5 件事再開查（避免做完發現方向歪掉）：

**1️⃣ 主題範圍** — 你想聚焦哪個面向？
- A. 商品本身（規格 / 定價 / 承保條件）
- B. 市場趨勢（滲透率 / 客群 / 通路）
- C. 競品比較（其他公司怎麼做）
- D. 法規環境
- E. 全部

> 推薦 **A+C**（商品設計團隊最常需要「自家商品 + 對標」組合）

---

**你 →** A+C

**Chat ←**
**2️⃣ 地區** — 看哪些市場？
- A. 只看台灣 / B. 含日韓港東南亞 / C. 全球

> 推薦 **A**（新光是台灣公司，主競品也在台灣，跨市場參考可在後段補）

---

**你 →** A

**Chat ←**
**3️⃣ 時間範圍**
- A. 近 30 天 / B. 近 90 天 / C. 近 1 年

> 推薦 **B**（90 天平衡時效跟趨勢）

---

**你 →** B

**Chat ←**
**4️⃣ 目標讀者**
- A. 商品設計團隊（技術細節 + 設計建議）
- B. 高階主管（決策摘要）
- C. 業務培訓（話術）

> 推薦 **A**

---

**你 →** A

**Chat ←**
**5️⃣ 報告深度**
- A. 雙週報短版 ~5 頁 / B. 月報中版 ~15 頁 / C. 完整研究 30+ 頁

> 推薦 **B**

---

**你 →** B

**Chat ←**
（內部呼叫 `confirm_scope(session_id, {scope:"A+C", region:"A", timeframe:"B", audience:"A", depth:"B"})`）

範圍鎖定 ✅。Server 給的 research plan：
- 蒐集 2+ 篇 KB 內現存舊報告（list_reports → get_report）
- 搜尋近 90 天台灣保險業新聞 — 從商品/通路/競品 3 個 query 角度
- 查 Wiki 月度蒸餾（get_wiki 2026-04 / 2026-05）
- 補外部 web_search — 監管公告 / 新聞 / 公司官網
- 預計 12-15 findings 後 generate_outline

開始查……

（內部依序呼叫多個 tool，每段證據 add_finding）

✅ 累積 13 個 findings：
- 5 篇近期新聞（IFRS17 影響 / 商品下架 / 通路重整 / 合併進度 / 健康險重點）
- 2 篇舊報告引用（V1 ch05 新光案例 / V1 ch15 通路比較）
- 4 個 web search（監管公告 / 公司官網商品線 / 法人說明會 / 同業評論）
- 2 個 cross_market_pattern 觀察

要 generate_outline 看看建議結構嗎？

---

**你 →** 好

**Chat ←**
（呼叫 `generate_outline(session_id)`）

建議大綱：
```
## 一、新光現況概要 [^1] [^4]
## 二、合併後組織與商品線變動 [^2] [^3] [^9]
## 三、商品策略觀察 [^5] [^6] [^7] [^11]
## 四、通路策略 [^8] [^12]
## 五、跨市場參考（V1 ch05/ch15）[^10] [^13]
## 六、給商品設計團隊的 takeaways
## 七、風險與限制
```

調整建議（你可選）：
- 把「合併」這節獨立並放最前？因為合併是當前最大變數
- 「跨市場參考」要不要插在「商品策略」章節中當對比，不獨立成節？

---

**你 →** 合併移最前。其他保持

**Chat ←**
（依用戶意見調整大綱結構，寫完整 markdown 內文，每個 fact 用 `[^N]` 引用）

寫完了，準備上架。先看現有主題：

（呼叫 `list_topics`）
- topic_v1_marketing「亞洲保險公司行銷策略研究 V1」
- topic_v2_flywheel「飛輪策略報告 V2」

兩個都不太適合（一個是綜合性歷史報告，一個是策略框架）。建議建新主題「新光人壽追蹤研究」 — 之後你想連續追蹤新光的話，後續報告都歸進來方便對比。

確認上架？

---

**你 →** 上架

**Chat ←**
（呼叫 `create_report(...)`）
```
{
  session_id: "rs_xxx",
  title: "新光人壽近況與商品策略研究 (2026-05)",
  markdown: "...完整內文...",
  category: "競品案例",
  region: "TW",
  summary: "聚焦新光與台新合併後組織與商品線變化，含通路策略觀察與商品設計建議",
  topic_id: "topic_xinkong_2026q2",
  topic_title: "新光人壽追蹤研究",
  topic_summary: "新光人壽 2026 年起的商品 / 通路 / 組織追蹤研究系列",
  sort_order: 0
}
```

✅ 報告已上架：

🔗 https://insurance-kb.cooperation.tw/reports/rpt_xxx
- 13 個 findings 已自動整成「## 參考資料」section
- 已建新主題「新光人壽追蹤研究」（在 sidebar 看得到）
- 字數 8500，閱讀約 12 分鐘
- TG 已通知 admin

---

## 三、第二份報告（同主題）

下個月你又想追蹤「新光的健康險策略」。同樣走完整流程，但 **`create_report` 帶同個 topic_id**：

```
{
  topic_id: "topic_xinkong_2026q2",   ← 同 ID
  topic_title 不用給（主題已存在）
  sort_order: 10,                       ← 第 1 章
  title: "新光人壽 2026Q3 健康險策略觀察",
  ...
}
```

Sidebar 自動把這份排在 V1 主報告下面。半年後你可能累積 5-6 份新光相關，主題頁就成了「新光研究室」的小型 wiki。

---

## 四、什麼時候 chat 應該主動踩煞車

VIP 用戶心理上會想「快點寫完一份」，但**有些情況 chat 應該明確說「先別衝」**：

| 訊號 | Chat 該做的事 |
|---|---|
| 用戶 5 步全選 D（什麼都要）/ 全選 C（最深）| 反問：「這樣會跑很久且失焦，建議先聚焦 X 再延伸 Y。要不要縮小範圍？」 |
| Findings < 5 但用戶催促上架 | 拒絕：「目前資料不足，建議再 search 2-3 輪，否則會是憑印象寫」 |
| 用戶要寫的論點沒對應 finding | 提示：「這條沒 source，要先 search_articles / web_search 找出處再寫」 |
| 同 source_url 出現 3+ 個 finding | 警告：「過度依賴單一來源，建議多元化」 |
| 用戶要把「我覺得」當事實寫進報告 | 拆分：「主觀觀察可放在『takeaways』section，事實段落只放有 source 的」 |

---

## 五、第一次連線驗證

新開 chat 問：

> 「列一下最近台灣保險業有什麼大事」

✅ 正確：Chat 第一動是 `search_articles({query:"台灣保險"})` 或 `list_articles({region:"TW"})`
❌ 失敗：Chat 憑訓練資料直接答 → profile 沒生效，回頭檢查 https://claude.ai/settings/profile 是否儲存成功 + connector 是否 connected

---

## 六、設計原理（為什麼長這樣）

**為什麼 chat 不能直接寫報告？**
用戶說「幫我研究 X」時心裡有具體想要的東西，但講不清楚。Chat 直接動手 = 寫出泛泛的長文，用戶看完說「不是這個意思」就要重做。**grill-me-first 把模糊意圖在 5 分鐘內變成具體決策**，比寫完再返工省 10 倍時間。

**為什麼 finding 要 server 維護不放 chat context？**
10 個 findings 可能就 50K-100K tokens（包含 source quote）。全塞 chat context 會把可用思考空間排擠掉，下半段討論大綱跟寫內文都變鈍。Server-side draft state 讓 chat 只看 finding ID 即可。

**為什麼 source_url 強制必填？**
保險業界研究最容易踩的雷是「LLM 幻覺數據」（編造 X 公司市佔率、Y 商品保費）。寫進報告流出去會被業內人嗤笑甚至引發合規問題。強制每個事實對應 source URL = footnote 可點驗證 = 報告經得起追溯。

**為什麼上架要走主題（topic_id）不直接散裝？**
研究是長期累積的活動。「新光的研究」三個月後可能有 5 份，主題化後 sidebar tree 自動成為「研究室」結構，可比較、可導覽、可給新人快速 onboarding。散裝報告半年後就找不到關聯。

---

對應的 server 端設計見 [v3-upgrade-spec.md](v3-upgrade-spec.md)。
