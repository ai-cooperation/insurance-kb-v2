/** Public Agent tool contract; actual selection/pagination lives in AgentReader. */
const range = {
  date_from: {type:"string",description:"發布日期起日 YYYY-MM-DD"},
  date_to: {type:"string",description:"發布日期迄日 YYYY-MM-DD，含當日"},
  all_history: {type:"boolean",description:"讀全部可見歷史；不能和 days/date range 混用"},
  days: {type:"integer",minimum:1,maximum:36500,description:"近 N 天；list 預設 30 天，search 預設全歷史"},
  category: {type:"string",description:"分類名稱，如 監管動態、產品創新"},
  region: {type:"string",description:"資料中的地區名稱，如 台灣、日本、韓國"},
  limit: {type:"integer",minimum:1,maximum:100,description:"本頁回傳上限，預設 30；不代表總命中數"},
  snapshot_id: {type:"string",description:"固定資料快照；從 list_knowledge 或前次結果取得"},
  cursor: {type:"string",description:"接續讀取時傳前次 next_cursor，可只傳 cursor；48 小時有效"},
};
const revision = {
  snapshot_id: {type:"string",description:"引用所屬快照；讀歷史引用或後續文字分段時必傳"},
  revision_id: {type:"string",description:"要求讀取的精確內容版本；不符即回錯誤"},
  offset: {type:"integer",minimum:0,description:"前次 next_offset；同時保留 snapshot_id 和 ID"},
};

export const AGENT_TOOLS = [
  {name:"list_knowledge",description:"查看保險 KB 可讀資料目錄、月份、筆數、最新文章日期、快照版本。月份是來源發布日期分桶，不是網站營運月數。所有資料限公開可見集合，非完整網頁全文。",inputSchema:{type:"object",properties:{snapshot_id:range.snapshot_id}}},
  {name:"list_articles",description:"按日期、分類、地區讀取保險 KB 新聞，預設近 30 天。跨月或全部歷史用 date_from/date_to 或 all_history。回傳摘要預覽及永久引用；完整保存內容用 get_article。必須續讀 next_cursor 直到 complete=true，才能宣稱範圍已讀完。",inputSchema:{type:"object",properties:range}},
  {name:"search_articles",description:"Agent 查找保險 KB 新聞。預設涵蓋全部可見歷史，可限日期/地區/分類。query 首次必填，接續可只傳 cursor。按月份分頁掃描，分數沿用關鍵字權重，但不是全域 top-k 排名。即使本頁 0 命中，只要 complete=false 就必須接續，不能宣稱查無資料。用 get_article 讀證據原紀錄。",inputSchema:{type:"object",properties:{...range,query:{type:"string",description:"關鍵字／公司名，首次搜尋必填"}}}},
  {name:"get_article",description:"依 article_id、snapshot_id、revision_id 讀回引用的完整保存紀錄。content 是 JSON 文字，長文透過 next_offset 分段；固定快照並串接所有段後解析。清楚區分 AI 摘要/摘錄/原文，保存摘要不等於網頁全文，可追溯不等於已核實。",inputSchema:{type:"object",properties:{article_id:{type:"string",description:"由搜尋結果 citation.article_id 取得"},...revision},required:["article_id"]}},
  {name:"get_wiki",description:"列出指定 month 的 Wiki 頁面，或用 page_id 讀完整保存 Markdown、引用鏈、生成範圍及 stale/unknown 狀態。不指定月份則列全部頁面。列表/長文都要接續 next_offset 並保留 snapshot_id。Wiki 是衍生整理，不是完整來源集；legacy lineage=unknown 不可冒稱可追溯。source_refs 可交 get_article 讀精確證據版本。",inputSchema:{type:"object",properties:{month:{type:"string",description:"YYYY-MM"},page_id:{type:"string",description:"從頁面清單取得"},limit:range.limit,...revision}}},
];
