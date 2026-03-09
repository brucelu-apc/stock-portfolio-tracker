# 台美股投顧追蹤工具 — 完整實作紀錄

> 專案：stock-portfolio-tracker（整合投顧通知追蹤功能）
> 初始建立：2026/02/12（v0.4.0）
> 最後更新：2026/03（v0.5.0）
> 規劃文件：Stock_Tracker_Plan.md（v3 整合版）

---

## 目錄

1. [專案概覽](#一專案概覽)
2. [技術棧](#二技術棧)
3. [Phase 1：後端骨架 + 通知解析器](#三phase-1後端骨架--通知解析器)
4. [Phase 2：股價監控引擎](#四phase-2股價監控引擎)
5. [Phase 3：LINE 通知整合](#五phase-3line-通知整合)
6. [Phase 4：Telegram + 轉發功能](#六phase-4telegram--轉發功能)
7. [Phase 5：完善 + 遷移](#七phase-5完善--遷移)
8. [Phase 6：即時報價架構升級（v0.5.0）](#八phase-6即時報價架構升級v050)
9. [Phase 7：管理後台 + 系統功能強化](#九phase-7管理後台--系統功能強化)
10. [Phase 8：UI 行動版優化](#十phase-8ui-行動版優化)
11. [檔案清單與行數統計（現況）](#十一檔案清單與行數統計現況)
12. [API 路由總表](#十二api-路由總表)
13. [排程工作總表](#十三排程工作總表)
14. [資料庫結構](#十四資料庫結構)
15. [架構設計決策](#十五架構設計決策)
16. [驗證結果](#十六驗證結果)

---

## 一、專案概覽

本工具的目的是將台灣投資顧問（投顧）透過 LINE 發送的股票通知文字，自動解析為結構化資料，並整合到既有的 stock-portfolio-tracker 投資組合管理系統中。新功能包含：

- **通知解析**：正規表達式解析投顧通知中的股票代碼、防守價、目標價
- **即時監控**：Railway 後端以 APScheduler 定時抓取台美股價，觸發防守/目標價警示
- **多平台通知**：LINE Flex Message + Telegram HTML 推送警示與月報
- **股票轉發**：將解析結果轉發至多個 LINE/Telegram 群組或個人
- **歷史追蹤**：三分頁查詢面板（警示歷史、歸檔目標、轉發紀錄）

---

## 二、技術棧

| 層級 | 技術 | 說明 |
|------|------|------|
| 前端 | React 18 + TypeScript + Vite 5 | SPA 架構 |
| UI 框架 | Chakra UI 2 + Framer Motion 10 | 響應式元件 + 動畫 |
| 圖表 | Recharts 3 | 資產配置、損益趨勢 |
| 資料庫 | Supabase PostgreSQL + RLS | 即時訂閱 + 行級安全 |
| 認證 | Supabase Auth (Email + Google) | |
| 後端 | FastAPI + APScheduler | Railway 部署 |
| 股價 API | twstock (台股即時) + yfinance (美股/收盤) | |
| 通知 | LINE Messaging API + Telegram Bot API | 雙平台推送 |
| CI/CD | GitHub Actions (備援) + Railway (主要) | |
| 前端部署 | Vercel | |
| 後端部署 | Railway (Docker) | |

---

## 三、Phase 1：後端骨架 + 通知解析器

### 3.1 目標
建立 FastAPI 後端骨架，實作投顧通知文字解析器。

### 3.2 新建檔案

**`backend/app/parser/notification_parser.py`** (470 行)
- 正規表達式模組，解析投顧通知中的：
  - 股票代碼與名稱（如「億光（2393）」→ ticker: "2393", name: "億光"）
  - 防守價（defense_price）
  - 最小漲幅目標（min_target_low, min_target_high）
  - 合理漲幅目標（reasonable_target_low, reasonable_target_high）
  - 建議買進價（entry_price）
  - 策略備註（strategy_notes）
  - 通知日期（多日期支援）
- 提供 `POST /api/parse` 路由，回傳 `ParseResponse`
- 提供 `POST /api/import` 路由，將解析結果寫入 Supabase

**`backend/app/main.py`** (138 行)
- FastAPI 應用程式入口
- Lifespan hook：啟動/關閉 Supabase client 與 APScheduler
- CORS 中介軟體（Vercel + Railway 域名）
- Router 掛載（Parser, LINE, Telegram, Forward）

**`backend/app/config.py`**
- Pydantic Settings 管理環境變數
- 支援 SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, LINE_*, TELEGRAM_* 等

**`backend/app/models/schemas.py`**
- Pydantic 資料模型定義

**`backend/Dockerfile`** (16 行)
- Python 3.11-slim 映像
- pip install 無 cache，暴露 port 8000

**`backend/requirements.txt`** (27 行)
- fastapi, uvicorn, supabase, httpx, apscheduler, twstock, yfinance 等

### 3.3 新建前端檔案

**`src/components/advisory/NotificationInput.tsx`** (186 行)
- 大型文字輸入區域，貼上 LINE 投顧通知
- 呼叫 `POST /api/parse` 送往後端解析
- 結果傳遞給 ParsePreview 元件

**`src/components/advisory/ParsePreview.tsx`** (298 行)
- 顯示解析結果的結構化預覽
- 股票勾選 + 批次匯入到 Supabase price_targets
- 轉發按鈕觸發 StockForwardModal

**`src/services/backend.ts`** (213 行)
- API 客戶端：parseNotification(), importStocks(), forwardStocks()
- ForwardTarget CRUD 函式
- 環境變數 VITE_BACKEND_URL 設定

### 3.4 資料庫遷移

**`supabase/migrations/002_advisory_tables.sql`** (237 行)
- 7 張新表：price_targets, advisory_tracking, price_alerts, forward_targets, forward_logs, user_messaging, advisory_notifications
- RLS 政策：每張表皆有 select/insert/update 權限控制
- 索引：ticker + is_latest 複合索引，triggered_at 排序索引

### 3.5 測試結果
- 解析器測試：34/34 檔股票正確辨識
- 日期解析：4/4 天正確抓取
- 驗證檢查：5/5 通過（防守價 < 目標價、必填欄位等）

---

## 四、Phase 2：股價監控引擎

### 4.1 目標
建立即時股價抓取 + 防守/目標價檢查 + 警示觸發系統。

### 4.2 新建檔案

**`backend/app/market/twstock_fetcher.py`** (136 行)
- 使用 `twstock` 套件抓取台股即時/收盤價
- `fetch_tw_prices(tickers)` → dict[ticker, PriceData]
- 錯誤處理：個股抓取失敗不影響其他

**`backend/app/market/yfinance_fetcher.py`** (194 行)
- 使用 `yfinance` 抓取美股/ETF 價格
- 台股代碼自動加 `.TW` 後綴
- 批次抓取 + 快取機制

**`backend/app/monitor/price_checker.py`** (262 行)
- 核心比價邏輯：逐一比對 current_price vs price_targets
- 觸發條件：
  - `defense_breach`: 跌破防守價
  - `min_target_reached`: 達最小漲幅目標
  - `reasonable_target_reached`: 達合理漲幅目標
- 寫入 `price_alerts` 表 + 去重（同一 ticker + alert_type 24 小時內不重複）
- 回傳觸發的警示列表供通知模組發送

**`backend/app/monitor/stock_monitor.py`** (529 行)
- APScheduler 排程器（AsyncIOScheduler）
- 4 個排程工作（見第十節）
- `init_monitor(supabase)` / `shutdown_monitor()` 生命週期
- `get_monitor_status()` 回傳排程狀態

### 4.3 修改檔案

**`src/components/advisory/AdvisoryTable.tsx`** (490 行)
- 即時追蹤表格：顯示防守價距離%、目標價距離%
- Supabase Realtime 訂閱 market_data 變動
- 追蹤狀態切換（觀察中/已進場/已出場/略過）

**`src/components/advisory/AlertPanel.tsx`** (307 行)
- 即時警示面板 + Framer Motion 動畫進場
- Realtime 訂閱 price_alerts 新增事件
- 已讀/全部已讀功能

---

## 五、Phase 3：LINE 通知整合

### 5.1 目標
整合 LINE Messaging API，實現雙向互動（webhook 接收 + push 推送）。

### 5.2 新建檔案

**`backend/app/messaging/line_notifier.py`** (597 行)
- LINE Messaging API 推送模組
- `send_push_message(to, messages)` — 基礎推送
- `send_alert_push(user_id, alert)` — 警示推送（Flex Message）
- `send_forward_push(target_id, stocks, raw_text)` — 轉發推送
- Flex Message 模板：色彩編碼（紅=跌破防守、綠=達標、金=合理目標）
- 配額管理：免費帳號每月 500 則限制，計數器追蹤

**`backend/app/messaging/line_handler.py`** (403 行)
- LINE Webhook 處理器（POST /webhook/line）
- Signature 驗證（HMAC-SHA256）
- 指令解析：
  - `/追蹤` — 查看追蹤清單
  - `/狀態` — 查看監控系統狀態
  - `/幫助` — 指令列表
  - 直接貼上通知文字 → 自動解析並匯入

### 5.3 修改檔案
- `stock_monitor.py` — 警示觸發後呼叫 `send_alert_push()` 推送 LINE

---

## 六、Phase 4：Telegram + 轉發功能

### 6.1 目標
新增 Telegram Bot 支援 + 股票資訊轉發到多群組。

### 6.2 新建檔案

**`backend/app/messaging/telegram_notifier.py`** (298 行)
- Telegram Bot API 推送模組
- `send_message(chat_id, text, parse_mode)` — 基礎推送
- `send_alert_message(chat_id, alert)` — HTML 格式警示
- `send_forward_message(chat_id, stocks, raw_text)` — 轉發格式化
- 無配額限制（相比 LINE 免費帳號的 500 則/月）

**`backend/app/messaging/telegram_handler.py`** (406 行)
- Telegram Webhook 處理器（POST /webhook/telegram）
- Update Token 驗證
- 指令解析：`/start`, `/track`, `/status`, `/help`
- 直接貼上通知文字 → 自動解析

**`backend/app/messaging/stock_forwarder.py`** (333 行)
- 轉發路由模組（路由自帶 /api/forward prefix）
- `POST /api/forward` — 執行轉發到選定目標
- `GET /api/forward/targets` — 查詢轉發目標列表
- `POST /api/forward/targets` — 新增轉發目標
- `DELETE /api/forward/targets/{id}` — 刪除轉發目標
- `GET /api/forward/logs` — 查詢轉發紀錄
- 轉發邏輯：依 platform (line/telegram) 分派到對應 notifier
- 轉發記錄寫入 `forward_logs` 表

### 6.3 新建前端檔案

**`src/components/advisory/StockForwardModal.tsx`** (441 行)
- 轉發目標選擇 Modal
- 目標管理：新增/刪除 LINE/Telegram 轉發目標
- 勾選目標 → 呼叫 `POST /api/forward`
- 結果顯示（成功/失敗計數）

**`src/components/settings/MessagingSettings.tsx`** (355 行)
- 通知偏好設定頁面
- LINE / Telegram 連結狀態顯示
- 通知開關：price_alert, daily_summary, monthly_report
- 儲存至 Supabase `user_messaging` 表

### 6.4 修改檔案
- `main.py` — 掛載 telegram_router + forward_router，版本升至 v0.4.0
- `backend.ts` — 新增 ForwardTarget 類型、forwardStocks()、CRUD 函式
- `stock_monitor.py` — 警示觸發後同時推送 Telegram
- `App.tsx` — 路由新增 advisory page + settings page

---

## 七、Phase 5：完善 + 遷移

### 7.1 Phase 5.1：月報遷移到 Railway

**問題**：原有月報流程依賴 GitHub Actions + Playwright（Chromium ~130MB），不適合 Docker 部署。

**解決方案**：改用結構化資料 → 平台原生富文字訊息，完全移除 Playwright 依賴。

**`backend/app/report/monthly_report.py`** (502 行) — 新建
- `collect_report_data(supabase)` — 彙總投資組合資料
  - 總市值、總成本、損益、ROI、匯率
  - Top 5 持股（依市值排序）
  - 當月投顧通知數、警示數、警示類型分布
- `build_report_flex(data)` — LINE Flex Message 氣泡
  - 深綠背景 + 金色標題的奢華風格
  - Header: "Investment Report"
  - Body: 投組概覽、損益、Top 5 持股
  - Footer: "查看 Dashboard" 按鈕
- `build_report_telegram_html(data)` — Telegram HTML
  - 獎牌 emoji（🥇🥈🥉）標示前三名持股
  - `<code>` 區塊顯示數值
  - 警示分類摘要
- `generate_and_send_report(supabase)` — 主進入點
  - 查詢 `user_messaging` 取得所有訂閱月報的使用者
  - 優先 Telegram（無限配額），再送 LINE
- `generate_report_preview(supabase)` — API 預覽（不發送）

**修改 `stock_monitor.py`**：
- 新增 Job 4: `monthly_report_job` — CronTrigger(day=1, hour=14, minute=30)

**修改 `main.py`**：
- 新增 `POST /api/report/generate` — send=false 預覽 / send=true 發送

### 7.2 Phase 5.2：GitHub Actions 簡化

**修改 `.github/workflows/market-update.yml`** (75 行)：
- 角色轉變：「主要執行者」→「備援/回退」
- 排程：僅平日執行，比 Railway 晚 1 小時
  - `0 7 * * 1-5` (台股收盤備援，Railway 06:00)
  - `0 22 * * 1-5` (美股收盤備援，Railway 21:30)
- 新增 Railway health check 步驟（curl /health）
- 移除 Playwright/Chromium 海報生成步驟
- 保留 yfinance 股價更新 + LINE 預警推送作為備援

### 7.3 Phase 5.3：投顧追蹤歷史面板

**`src/components/advisory/AdvisoryHistory.tsx`** (516 行) — 新建
- 三分頁查詢面板：
  - **Tab 1 — 警示歷史**：查詢 `price_alerts` 表
    - 依 alert_type 篩選（全部/跌破防守/達標/停利停損）
    - 可捲動表格 + 固定表頭
  - **Tab 2 — 歸檔目標**：查詢 `price_targets` WHERE `is_latest = false`
    - 顯示歷史防守價/目標價
  - **Tab 3 — 轉發紀錄**：查詢 `forward_logs` JOIN `forward_targets`
    - 顯示轉發時間、目標名稱、平台
- 上方摘要統計列：總警示數、防守價破位次數、達標次數、追蹤個股數
- 期間選擇器：7 / 30 / 90 / 365 天

**修改 `src/App.tsx`**：
- 匯入 AdvisoryHistory 元件，放置在 advisory 頁面 AdvisoryTable 下方

### 7.4 Phase 5.4：手機響應式優化

修改所有外層容器使用 Chakra UI 響應式 props：

| 元件 | 變更 |
|------|------|
| `AdvisoryHistory.tsx` | `p={8}` → `p={{ base: 4, md: 8 }}`，Header Flex 垂直排列 |
| `ParsePreview.tsx` | `p={8}` → `p={{ base: 4, md: 8 }}` |
| `NotificationInput.tsx` | `p={8}` → `p={{ base: 4, md: 8 }}`，Header Flex 垂直排列 |
| `AdvisoryTable.tsx` | `p={8}` → `p={{ base: 4, md: 8 }}`，Header Flex + Select 寬度自適應 |
| `AlertPanel.tsx` | `p={6}` → `p={{ base: 4, md: 6 }}` |

說明：`base` 為手機（< 768px），`md` 為桌面（≥ 768px）。

### 7.5 Phase 5.5：端到端驗證

| 檢查項目 | 結果 |
|----------|------|
| 後端 Python 語法檢查 | 13/13 模組通過 ✅ |
| 前端未使用 import 清理 | 6 個元件已清理 ✅ |
| Vite 生產建置 | 1767 modules, 0 errors ✅ |
| 產出檔案 | dist/index.html + dist/assets/index.js (357KB gzip) ✅ |

---

---

## 八、Phase 6：即時報價架構升級（v0.5.0）

### 8.1 目標

取代純輪詢（twstock 每 15 分鐘）的架構，引入 WebSocket 長連線以實現秒級更新，同時保留輪詢作為備援。

### 8.2 新建檔案

**`backend/app/market/quote_manager.py`** (305 行)
- 統一即時報價協調器（QuoteManager class）
- 持有並管理所有資料來源客戶端（Fugle / Finnhub / Shioaji）
- 依市場交易時段自動啟動/停止各資料來源
- 提供統一的 health-check dict 給 `/api/monitor/status`
- 由 `stock_monitor.init_monitor()` 建立並管理生命週期

**`backend/app/market/fugle_ws_client.py`** (514 行)
- Fugle WebSocket 客戶端（台股盤中即時報價，09:00-13:30 TST）
- 包裝 `fugle-marketdata` Python SDK
- 自動重連（exponential backoff，1s → 60s）
- 動態訂閱/取消訂閱個別 ticker
- 每筆報價寫入 Supabase `market_data.realtime_price`
- 需要環境變數：`FUGLE_API_KEY`, `FUGLE_ENABLED=true`

**`backend/app/market/finnhub_ws_client.py`** (332 行)
- Finnhub WebSocket 客戶端（美股即時報價，09:30-16:00 ET）
- 使用 `websocket-client` 套件連接 `wss://ws.finnhub.io`
- 市場時段外自動忽略報價（確保收盤後顯示「休市」）
- Thread-safe asyncio 橋接（Finnhub WS 使用獨立執行緒）
- 需要環境變數：`FINNHUB_API_KEY`, `FINNHUB_ENABLED=true`

**`backend/app/market/dynamic_subscription.py`** (182 行)
- 動態訂閱掃描器（DynamicSubscription class）
- 每 5 分鐘掃描 Supabase `portfolio_holdings` + `price_targets`
- 自動更新 QuoteManager 的訂閱列表（新持股自動訂閱、已出清自動退訂）
- 分離台股 / 美股 ticker 集合

**`backend/app/market/polygon_fallback.py`**
- Polygon REST API 備援（美股，供未來擴充）

**`backend/app/market/shioaji_client.py`**
- Shioaji 券商 API 客戶端（台股券商級報價，供未來擴充）
- 需要環境變數：`SHIOAJI_API_KEY`, `SHIOAJI_SECRET_KEY`, `SHIOAJI_ENABLED=true`

### 8.3 修改檔案

**`backend/app/monitor/stock_monitor.py`** (529 → 1121 行)
- 排程工作從 4 個擴充到 6 個（見第十三節）
- Job 1（`alert_check`）：每 30 秒純比對 market_data，不再負責抓價
- Job 2（`realtime_tw_fallback`）：twstock 每 90 秒輪詢，WS 健康時短路
- Job 5（`realtime_us_fallback`）：yfinance/Finnhub REST 每 5 分鐘，美股開市才執行

**`backend/app/market/twstock_fetcher.py`** (136 → 359 行)
- 擴充支援 WS 降級偵測邏輯

**`backend/app/market/yfinance_fetcher.py`** (194 → 507 行)
- 擴充支援 US 盤中輪詢 + 收盤價分離

### 8.4 資料庫遷移

**`migration_v2.sql`**：
- `market_data` 新增 `realtime_price`（盤中即時）、`close_price`（收盤價）
- `market_data.ticker` 加入 UNIQUE 約束（確保 upsert 正確）
- 回填舊資料：`close_price = current_price`

### 8.5 架構設計原則

```
WS 優先，輪詢備援：
  Fugle WS (台股盤中) ─┐
  twstock 每 90s ───────┤─→ market_data.realtime_price ─→ alert_check
  Finnhub WS (美股盤中) ┤
  yfinance 每 5min ──────┘

  yfinance 每日收盤後 ──→ market_data.close_price

  current_price = 盤中取 realtime_price，收盤後取 close_price
```

---

## 九、Phase 7：管理後台 + 系統功能強化

### 9.1 新建後端檔案

**`backend/app/routers/registrations.py`** (77 行)
- 使用者註冊申請處理路由
- 新使用者送出個人資料後觸發 Email 通知管理員

**`backend/app/email/sender.py`** (131 行)
- SMTP Email 發送模組
- 新使用者申請時通知管理員信箱
- 讀取 `admin_email_config` 表取得通知信箱

### 9.2 新建前端元件

**`src/components/admin/UserManagement.tsx`** (172 行)
- 管理後台 — 使用者管理頁面
- 審核新申請（啟用 / 拒絕 / 停用）
- 調整使用者角色與投顧功能存取權限（`can_access_advisory`）

**`src/components/admin/AnnouncementEditor.tsx`** (280 行)
- 管理後台 — 系統公告編輯器
- 新增 / 修改 / 刪除 `announcements` 表中的公告
- 切換公告顯示狀態（is_active）

**`src/components/admin/AdminEmailConfig.tsx`** (219 行)
- 管理後台 — Email 通知設定
- 設定接收新使用者申請通知的管理員信箱

**`src/components/common/AnnouncementModal.tsx`** (89 行)
- 登入後自動顯示最新公告的 Modal
- 讀取 `announcements` 表中 `is_active=true` 的最新一筆

**`src/components/auth/PersonalInfoModal.tsx`** (203 行)
- 首次登入後彈出的個人資料填寫表單
- 寫入 `user_registration_info` 表

### 9.3 資料庫遷移

**`migration.sql`**：
- 新增 `announcements` 表（公告系統）
- `user_profiles` 新增 `can_access_advisory` 欄位（投顧功能權限）
- 新增 `user_registration_info` 表（註冊填寫資訊）
- 新增 `admin_email_config` 表（管理員通知信箱）

---

## 十、Phase 8：UI 行動版優化

### 10.1 HoldingsTable.tsx 優化

- **停利/損欄位恢復**：移除 `display={{ base: 'none', xl: 'table-cell' }}`，改為水平捲動
- **Sticky 首欄**：`代碼/地區` 欄位設為 `position: sticky; left: 0`
  - `<Th>` zIndex=2，`<Td>` zIndex=1，背景色填充防穿透
  - `<Tr role="group">` + `<Td _groupHover={{ bg: 'gray.50' }}>` 同步 hover 背景

### 10.2 AdvisoryTable.tsx 重構

- **可捲動表格**：以 `<Box overflowX/Y maxH="600px">` 取代 `TableContainer`
- **Sticky 表頭**：`<Thead position="sticky" top={0} zIndex={1}>`
- **分頁功能**：preset `[10, 20, 50]`，自訂 5–200，預設 20
  - `safePage = Math.min(currentPageNum, totalPages)` 讀取時 clamp（不用 useEffect）
  - 篩選變動時 `setCurrentPageNum(1)` 重置頁碼

### 10.3 通知訊息修正

**`backend/app/monitor/stock_monitor.py`**：
- `name_map` 由 `portfolio_holdings` 建立後，再用 `price_targets.stock_name` 補充
- 確保投顧專屬股票（未在持股中）的 Telegram 警示包含股票名稱

**`scripts/update_market_data.py`**：
- 停損預警 alert dict 加入 `"name": h.get('name', '')`
- LINE 推送訊息格式更新為 `代碼：2330　台積電`（全形空格分隔）

---

## 十一、檔案清單與行數統計（現況）

### 後端 Python 模組

| 檔案 | 行數 | 階段 | 說明 |
|------|------|------|------|
| `backend/app/main.py` | 312 | P1+ | FastAPI 入口 + 路由掛載 |
| `backend/app/config.py` | — | P1 | 環境變數設定（含 WS 設定） |
| `backend/app/parser/notification_parser.py` | 976 | P1 | 通知解析器 + /parse, /import |
| `backend/app/market/twstock_fetcher.py` | 359 | P2 | 台股輪詢抓取（WS 備援） |
| `backend/app/market/yfinance_fetcher.py` | 507 | P2 | 美股/ETF 輪詢抓取（WS 備援） |
| `backend/app/market/quote_manager.py` | 305 | P6 | 統一即時報價協調器 |
| `backend/app/market/fugle_ws_client.py` | 514 | P6 | Fugle WebSocket（台股即時） |
| `backend/app/market/finnhub_ws_client.py` | 332 | P6 | Finnhub WebSocket（美股即時） |
| `backend/app/market/dynamic_subscription.py` | 182 | P6 | 動態訂閱掃描器 |
| `backend/app/monitor/price_checker.py` | 280 | P2 | 防守價/目標價比對引擎 |
| `backend/app/monitor/stock_monitor.py` | 1,121 | P2+ | APScheduler 排程器（6 個工作） |
| `backend/app/messaging/line_notifier.py` | 623 | P3 | LINE 推送模組 |
| `backend/app/messaging/line_handler.py` | 525 | P3 | LINE Webhook 處理 |
| `backend/app/messaging/telegram_notifier.py` | 322 | P4 | Telegram 推送模組 |
| `backend/app/messaging/telegram_handler.py` | 406 | P4 | Telegram Webhook 處理 |
| `backend/app/messaging/stock_forwarder.py` | 376 | P4 | 轉發路由 + 邏輯 |
| `backend/app/report/monthly_report.py` | 516 | P5 | 月報生成（Flex + HTML） |
| `backend/app/routers/registrations.py` | 77 | P7 | 使用者註冊申請路由 |
| `backend/app/email/sender.py` | 131 | P7 | SMTP Email 發送模組 |
| **後端小計** | **7,864** | | |

### 前端 TypeScript/React 元件

| 檔案 | 行數 | 階段 | 說明 |
|------|------|------|------|
| `src/components/advisory/NotificationInput.tsx` | 243 | P1 | 通知文字輸入 |
| `src/components/advisory/ParsePreview.tsx` | 607 | P1 | 解析結果預覽 + 匯入 |
| `src/components/advisory/AdvisoryTable.tsx` | 890 | P2+P8 | 即時追蹤表格（含分頁、sticky 欄）|
| `src/components/advisory/AlertPanel.tsx` | 352 | P2 | 即時警示面板 |
| `src/components/advisory/StockForwardModal.tsx` | 749 | P4 | 轉發目標選擇 Modal |
| `src/components/advisory/AdvisoryHistory.tsx` | 813 | P5 | 歷史查詢三分頁面板 |
| `src/components/settings/MessagingSettings.tsx` | 362 | P4 | 通知偏好設定 |
| `src/components/holdings/HoldingsTable.tsx` | 612 | P8 | 持股清單（sticky 首欄、分頁）|
| `src/components/admin/UserManagement.tsx` | 172 | P7 | 管理後台 — 使用者管理 |
| `src/components/admin/AnnouncementEditor.tsx` | 280 | P7 | 管理後台 — 公告編輯器 |
| `src/components/admin/AdminEmailConfig.tsx` | 219 | P7 | 管理後台 — Email 設定 |
| `src/components/common/AnnouncementModal.tsx` | 89 | P7 | 登入後公告 Modal |
| `src/components/auth/PersonalInfoModal.tsx` | 203 | P7 | 首次登入個人資料表單 |
| `src/services/backend.ts` | 431 | P1+ | API 客戶端 |
| `src/hooks/useRealtimeSubscription.ts` | 136 | P2 | Supabase Realtime 訂閱 Hook |
| **前端小計** | **6,218** | | |

### 基礎設施

| 檔案 | 行數 | 說明 |
|------|------|------|
| `supabase/migrations/001_initial_schema.sql` | — | 初始表結構 |
| `supabase/migrations/002_advisory_tables.sql` | 237 | 7 張投顧追蹤表 + RLS + 索引 |
| `supabase/migrations/003–005_*.sql` | — | 補丁遷移 |
| `migration.sql` | — | 公告、投顧權限、註冊強化 |
| `migration_v2.sql` | — | market_data 即時/收盤分離 |
| `.github/workflows/market-update.yml` | 75 | 備援排程 + health check |
| `backend/Dockerfile` | 16 | Python 3.11 Docker 映像 |
| `backend/requirements.txt` | — | Python 依賴 |

### 總計

| 分類 | 行數 |
|------|------|
| 後端 Python | 7,864 |
| 前端 TypeScript | 6,218 |
| **總計** | **14,082+** |

---

## 十二、API 路由總表

### Router 掛載路由

| 方法 | 路徑 | Router | 說明 |
|------|------|--------|------|
| POST | `/api/parse` | Parser | 解析通知文字 |
| POST | `/api/import` | Parser | 匯入解析結果到 DB |
| POST | `/webhook/line` | LINE Bot | LINE Webhook 接收 |
| POST | `/webhook/telegram` | Telegram Bot | Telegram Webhook 接收 |
| POST | `/api/forward` | Forward | 轉發股票到多目標 |
| GET | `/api/forward/targets` | Forward | 查詢轉發目標列表 |
| POST | `/api/forward/targets` | Forward | 新增轉發目標 |
| DELETE | `/api/forward/targets/{id}` | Forward | 刪除轉發目標 |
| GET | `/api/forward/logs` | Forward | 查詢轉發紀錄 |
| POST | `/api/registrations` | Registrations | 提交使用者申請資料 |

### main.py 直接路由

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/api/monitor/status` | 監控系統狀態（含 WS 健康資訊） |
| POST | `/api/prices/refresh` | 手動觸發全量價格刷新 |
| POST | `/api/prices/realtime-refresh` | 手動觸發即時報價刷新（台+美） |
| POST | `/api/prices/close-refresh` | 手動觸發收盤價刷新 |
| POST | `/api/report/generate` | 月報預覽/發送（send=true/false） |
| GET | `/health` | 健康檢查 |

---

## 十三、排程工作總表

| # | 工作 ID | 觸發條件 | 說明 |
|---|---------|----------|------|
| 1 | `alert_check` | 每 30 秒 | 從 market_data 讀值比對警示（不負責抓價） |
| 2 | `realtime_tw_fallback` | 每 90 秒 | twstock 台股輪詢；Fugle WS 健康時短路 |
| 3 | `daily_tw_close` | 每日 14:05 TST | 台股收盤後 yfinance 更新收盤價 |
| 4 | `daily_us_close` | 每日 06:30 TST | 美股收盤後 yfinance + 匯率更新 |
| 5 | `realtime_us_fallback` | 每 5 分鐘 | yfinance/Finnhub REST 美股輪詢；非美股時段短路 |
| 6 | `monthly_report` | 每月 1 日 14:30 TST | 月報生成並推送（Telegram 優先，LINE 輔助） |

GitHub Actions 備援排程（Railway 正常時 health check 後自動跳過）：
- `0 7 * * 1-5` UTC（TST 15:00）→ 台股收盤備援
- `0 22 * * 1-5` UTC（TST 06:00）→ 美股收盤備援

---

## 十四、資料庫結構

詳見 [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md)。

---

## 十五、架構設計決策

### 12.1 月報從 Playwright → 原生富文字

**問題**：原流程 `generate_report_html.py → Playwright render → PNG → OpenClaw → LINE`，Playwright 需要 Chromium (~130MB)，不適合 Docker 部署。

**方案**：結構化資料 → LINE Flex Message + Telegram HTML，完全移除 Chromium 依賴。

**效果**：
- Docker image 體積減少 ~130MB
- 手機上原生 Flex Message 體驗更好（可點擊、可互動）
- Telegram HTML 支援 code block、粗體等格式
- 無需維護 Playwright 版本相容性

### 12.2 GitHub Actions 角色轉變

**問題**：Railway 已承擔所有排程工作，GitHub Actions 變得冗餘。

**方案**：保留 GitHub Actions 作為「備援」，而非刪除。

**設計**：
- 排程比 Railway 晚 1 小時
- 執行前先 curl Railway `/health`
- 如果 Railway 已處理（market_data.updated_at 在 2 小時內），跳過更新
- 確保單一來源不可用時仍有回退

### 12.3 Telegram 優先於 LINE

**原因**：LINE 免費帳號每月 500 則推送限制，Telegram Bot API 無限制。

**設計**：
- 月報/警示優先透過 Telegram 發送
- LINE 作為輔助通道（對台灣用戶 LINE 更普及）
- `user_messaging` 表記錄每位使用者的偏好平台

### 12.4 即時訂閱架構

**設計**：前端透過 Supabase Realtime 訂閱 `market_data` 和 `price_alerts` 表的變動，後端更新價格後，前端立即反映。

**好處**：
- 不需要前端輪詢（polling）
- 後端只負責寫入 DB，不需要 WebSocket 伺服器
- Supabase 處理連線管理和重連

### 12.5 防守價/目標價去重機制

**設計**：`price_checker.py` 在觸發警示前，先查詢同一 ticker + alert_type 在過去 24 小時內是否已有記錄。

**原因**：盤中每 15 分鐘檢查一次，如果某股持續在防守價附近震盪，不應每 15 分鐘都發通知。

---

## 十六、驗證結果

### 後端模組語法驗證

```
✅ backend/app/report/monthly_report.py
✅ backend/app/messaging/line_notifier.py
✅ backend/app/messaging/line_handler.py
✅ backend/app/messaging/telegram_notifier.py
✅ backend/app/messaging/telegram_handler.py
✅ backend/app/messaging/stock_forwarder.py
✅ backend/app/monitor/price_checker.py
✅ backend/app/monitor/stock_monitor.py
✅ backend/app/parser/notification_parser.py
✅ backend/app/main.py
✅ scripts/update_market_data.py
✅ scripts/generate_report_html.py
✅ scripts/render_poster.py

結果：13/13 模組通過
```

### 前端建置驗證

```
vite v5.4.21 building for production...
✓ 1767 modules transformed
✓ built in 3.77s

dist/index.html                    0.40 kB │ gzip:   0.28 kB
dist/assets/index-EL3AiOlI.js  1,162.08 kB │ gzip: 357.36 kB

結果：0 errors, 1767 modules
```

### 解析器測試（Phase 1）

```
✅ 34/34 檔股票正確辨識
✅ 4/4 天日期正確抓取
✅ 5/5 驗證檢查通過
```

---

## 附錄：環境變數清單

| 變數 | 用途 | 階段 |
|------|------|------|
| `SUPABASE_URL` | Supabase 專案 URL | P1 |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Service Role Key | P1 |
| `FRONTEND_URL` | 前端域名（CORS） | P1 |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Messaging API Token | P3 |
| `LINE_CHANNEL_SECRET` | LINE Webhook 驗證密鑰 | P3 |
| `LINE_ALERT_TARGET_ID` | LINE 預設推送目標 | P3 |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot API Token | P4 |
| `TELEGRAM_WEBHOOK_SECRET` | Telegram Webhook 驗證密鑰 | P4 |
| `TELEGRAM_DEFAULT_CHAT_ID` | Telegram 預設推送 Chat ID | P4 |
| `VITE_BACKEND_URL` | 前端連接後端的 URL | P1 |
| `VITE_SUPABASE_URL` | 前端 Supabase URL | 既有 |
| `VITE_SUPABASE_ANON_KEY` | 前端 Supabase Anon Key | 既有 |
