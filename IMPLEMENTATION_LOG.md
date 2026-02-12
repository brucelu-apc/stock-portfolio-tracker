# 台美股投顧追蹤工具 — 完整實作紀錄

> 專案：stock-portfolio-tracker（整合投顧通知追蹤功能）
> 時間：2026/02/12
> 版本：v0.4.0
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
8. [檔案清單與行數統計](#八檔案清單與行數統計)
9. [API 路由總表](#九api-路由總表)
10. [排程工作總表](#十排程工作總表)
11. [資料庫結構](#十一資料庫結構)
12. [架構設計決策](#十二架構設計決策)
13. [驗證結果](#十三驗證結果)

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
- 7 張新表：price_targets, advisory_tracking, price_alerts, forward_targets, forward_logs, user_messaging, notification_raw
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
- LINE Webhook 處理器（POST /api/line/webhook）
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
- Telegram Webhook 處理器（POST /api/telegram/webhook）
- Update Token 驗證
- 指令解析：`/start`, `/track`, `/status`, `/help`
- 直接貼上通知文字 → 自動解析

**`backend/app/messaging/stock_forwarder.py`** (333 行)
- 轉發路由模組（Router prefix: /api/forward）
- `POST /api/forward/stocks` — 執行轉發到選定目標
- `GET /api/forward/targets` — 查詢轉發目標列表
- `POST /api/forward/targets` — 新增轉發目標
- `DELETE /api/forward/targets/{id}` — 刪除轉發目標
- 轉發邏輯：依 platform (line/telegram) 分派到對應 notifier
- 轉發記錄寫入 `forward_logs` 表

### 6.3 新建前端檔案

**`src/components/advisory/StockForwardModal.tsx`** (441 行)
- 轉發目標選擇 Modal
- 目標管理：新增/刪除 LINE/Telegram 轉發目標
- 勾選目標 → 呼叫 `POST /api/forward/stocks`
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

## 八、檔案清單與行數統計

### 後端 Python 模組

| 檔案 | 行數 | 階段 | 說明 |
|------|------|------|------|
| `backend/app/main.py` | 138 | P1 | FastAPI 入口 + 路由掛載 |
| `backend/app/config.py` | — | P1 | 環境變數設定 |
| `backend/app/parser/notification_parser.py` | 470 | P1 | 通知解析器 + /parse, /import |
| `backend/app/market/twstock_fetcher.py` | 136 | P2 | 台股即時價格抓取 |
| `backend/app/market/yfinance_fetcher.py` | 194 | P2 | 美股/ETF 價格抓取 |
| `backend/app/monitor/price_checker.py` | 262 | P2 | 防守價/目標價比對引擎 |
| `backend/app/monitor/stock_monitor.py` | 529 | P2 | APScheduler 排程器 |
| `backend/app/messaging/line_notifier.py` | 597 | P3 | LINE 推送模組 |
| `backend/app/messaging/line_handler.py` | 403 | P3 | LINE Webhook 處理 |
| `backend/app/messaging/telegram_notifier.py` | 298 | P4 | Telegram 推送模組 |
| `backend/app/messaging/telegram_handler.py` | 406 | P4 | Telegram Webhook 處理 |
| `backend/app/messaging/stock_forwarder.py` | 333 | P4 | 轉發路由 + 邏輯 |
| `backend/app/report/monthly_report.py` | 502 | P5 | 月報生成（Flex + HTML） |
| **後端小計** | **4,268** | | |

### 前端 TypeScript/React 元件

| 檔案 | 行數 | 階段 | 說明 |
|------|------|------|------|
| `src/components/advisory/NotificationInput.tsx` | 186 | P1 | 通知文字輸入 |
| `src/components/advisory/ParsePreview.tsx` | 298 | P1 | 解析結果預覽 + 匯入 |
| `src/components/advisory/AdvisoryTable.tsx` | 490 | P2 | 即時追蹤表格 |
| `src/components/advisory/AlertPanel.tsx` | 307 | P2 | 即時警示面板 |
| `src/components/advisory/StockForwardModal.tsx` | 441 | P4 | 轉發目標選擇 Modal |
| `src/components/advisory/AdvisoryHistory.tsx` | 516 | P5 | 歷史查詢三分頁面板 |
| `src/components/settings/MessagingSettings.tsx` | 355 | P4 | 通知偏好設定 |
| `src/services/backend.ts` | 213 | P1 | API 客戶端 |
| **前端小計** | **2,806** | | |

### 基礎設施

| 檔案 | 行數 | 說明 |
|------|------|------|
| `supabase/migrations/002_advisory_tables.sql` | 237 | 7 張新表 + RLS + 索引 |
| `.github/workflows/market-update.yml` | 75 | 備援排程 + health check |
| `backend/Dockerfile` | 16 | Python 3.11 Docker 映像 |
| `backend/requirements.txt` | 27 | Python 依賴 |
| **基礎設施小計** | **355** | |

### 總計

| 分類 | 行數 |
|------|------|
| 後端 Python | 4,268 |
| 前端 TypeScript | 2,806 |
| 基礎設施 | 355 |
| **總計** | **7,429** |

---

## 九、API 路由總表

### Router 掛載路由

| 方法 | 路徑 | Router | 說明 |
|------|------|--------|------|
| POST | `/api/parse` | Parser | 解析通知文字 |
| POST | `/api/import` | Parser | 匯入解析結果到 DB |
| POST | `/api/line/webhook` | LINE Bot | LINE Webhook 接收 |
| POST | `/api/telegram/webhook` | Telegram Bot | Telegram Webhook 接收 |
| POST | `/api/forward/stocks` | Forward | 轉發股票到多目標 |
| GET | `/api/forward/targets` | Forward | 查詢轉發目標列表 |
| POST | `/api/forward/targets` | Forward | 新增轉發目標 |
| DELETE | `/api/forward/targets/{id}` | Forward | 刪除轉發目標 |

### main.py 直接路由

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/api/monitor/status` | 監控系統狀態 |
| POST | `/api/prices/refresh` | 手動觸發價格刷新 |
| POST | `/api/report/generate` | 月報預覽/發送 (send=true/false) |
| GET | `/health` | 健康檢查 |

---

## 十、排程工作總表

| # | 工作 ID | 觸發條件 | 時區 | 說明 |
|---|---------|----------|------|------|
| 1 | `tw_intraday_check` | 每 15 分鐘 (09:00-13:30) | TST (UTC+8) | 台股盤中即時監控 |
| 2 | `tw_close_check` | 平日 14:00 | TST | 台股收盤後最終比價 |
| 3 | `us_close_check` | 平日 07:00 | TST | 美股收盤後更新 |
| 4 | `monthly_report` | 每月 1 日 14:30 | TST | 月報生成 + 推送 |

GitHub Actions 備援排程（比 Railway 晚 1 小時）：
- `0 7 * * 1-5` → 台股收盤備援 (UTC)
- `0 22 * * 1-5` → 美股收盤備援 (UTC)

---

## 十一、資料庫結構

### 新增表（002_advisory_tables.sql）

```
price_targets          — 投顧目標價（is_latest 標記最新版本）
advisory_tracking      — 使用者追蹤狀態（watching/entered/exited/ignored）
price_alerts           — 觸發的價格警示（defense_breach/target_reached 等）
forward_targets        — 轉發目標（LINE group/Telegram chat）
forward_logs           — 轉發歷史記錄
user_messaging         — 使用者通知偏好（LINE/Telegram ID + 開關）
advisory_notifications — 原始通知文字備份（含 message_type、source 欄位）
```

### 關鍵索引

```sql
idx_price_targets_latest   ON price_targets(ticker, is_latest)
idx_price_alerts_triggered ON price_alerts(triggered_at DESC)
idx_advisory_tracking_user ON advisory_tracking(user_id, ticker)
```

---

## 十二、架構設計決策

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

## 十三、驗證結果

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
