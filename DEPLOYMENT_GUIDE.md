# 部署指南 — 台美股投顧追蹤工具

> 版本：v0.5.0
> 更新日期：2026/03

---

## 架構總覽

```
┌────────────┐     ┌──────────────────────────┐     ┌──────────────┐
│  Vercel    │     │  Railway (Docker)        │     │  Supabase    │
│  (前端)    │────▶│  FastAPI + APScheduler   │────▶│  PostgreSQL  │
│  React SPA │     │  6 排程工作               │     │  Auth + RLS  │
└────────────┘     └────────────┬─────────────┘     └──────────────┘
                                │
              ┌─────────────────┼──────────────────┐
              ▼                 ▼                   ▼
       ┌──────────┐      ┌──────────┐       ┌────────────────┐
       │  LINE    │      │ Telegram │       │  即時報價來源   │
       │  Bot     │      │  Bot     │       │  Fugle WS (TW) │
       └──────────┘      └──────────┘       │  Finnhub WS(US)│
                                            │  twstock (備援)│
                                            │  yfinance (備援)│
                                            └────────────────┘

備援：GitHub Actions（比 Railway 晚執行，Railway 正常時自動跳過）
```

---

## 第一步：推送程式碼到 GitHub

```bash
cd stock-portfolio-tracker
git add .
git commit -m "your commit message"
git push origin master
```

---

## 第二步：Supabase 資料庫遷移

### 方法 A：透過 Supabase Dashboard（推薦）

1. 登入 [Supabase Dashboard](https://supabase.com/dashboard)
2. 選擇你的專案 → 前往 **SQL Editor**
3. 依序執行以下遷移檔（順序重要）：

| 步驟 | 檔案 | 說明 |
|------|------|------|
| 1 | `supabase/migrations/001_initial_schema.sql` | 初始結構（holdings、market_data） |
| 2 | `supabase/migrations/002_advisory_tables.sql` | 投顧追蹤 7 張表 |
| 3 | `supabase/migrations/003_messaging_directory_rpc.sql` | 通訊錄 RPC |
| 4 | `supabase/migrations/004_add_stock_name.sql` | price_targets stock_name 欄位 |
| 5 | `supabase/migrations/004b_backfill_stock_names.sql` | stock_name 回填 |
| 6 | `supabase/migrations/005_fix_update_source_constraint.sql` | 約束修正 |
| 7 | `migration.sql` | 公告、投顧權限、註冊強化 |
| 8 | `migration_v2.sql` | market_data 加入 realtime_price / close_price |

### 方法 B：透過 Supabase CLI

```bash
npm install -g supabase
supabase link --project-ref <YOUR_PROJECT_REF>
supabase db push
```

### 驗證遷移成功

在 SQL Editor 執行：

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```

應該看到這些表：
`advisory_notifications`, `advisory_tracking`, `admin_email_config`, `announcements`,
`forward_logs`, `forward_targets`, `historical_holdings`, `market_data`,
`portfolio_holdings`, `price_alerts`, `price_targets`, `user_messaging`,
`user_profiles`, `user_registration_info`

---

## 第三步：部署後端到 Railway

### 3.1 建立 Railway 專案

1. 登入 [Railway](https://railway.app)
2. 點擊 **New Project** → **Deploy from GitHub repo**
3. 選擇此 repo
4. **Root Directory** 設為 `backend`（重要！Railway 需在此找到 `Dockerfile`）
5. Railway 自動偵測 Dockerfile 並建置

### 3.2 設定環境變數

在 Railway 專案的 **Variables** 頁面新增：

**必填：**

| 變數名稱 | 說明 |
|----------|------|
| `SUPABASE_URL` | Supabase 專案 URL（`https://xxxxx.supabase.co`） |
| `SUPABASE_SERVICE_ROLE_KEY` | Settings → API → service_role key |
| `FRONTEND_URL` | Vercel 前端網址（CORS 用） |
| `PORT` | `8000` |

**通知（至少選一）：**

| 變數名稱 | 說明 |
|----------|------|
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token（優先，無配額限制） |
| `TELEGRAM_DEFAULT_CHAT_ID` | Telegram 預設推送 Chat ID |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Bot Channel Access Token（500則/月限制） |
| `LINE_CHANNEL_SECRET` | LINE Webhook 驗證密鑰 |
| `LINE_ALERT_TARGET_ID` | LINE 預設推送目標 ID |

**即時報價（選用，不設定則使用 twstock/yfinance 輪詢備援）：**

| 變數名稱 | 說明 |
|----------|------|
| `FUGLE_API_KEY` | Fugle 台股 WebSocket API Key |
| `FUGLE_ENABLED` | `true` 啟用 Fugle WS（預設 `false`） |
| `FINNHUB_API_KEY` | Finnhub 美股 WebSocket API Key |
| `FINNHUB_ENABLED` | `true` 啟用 Finnhub WS（預設 `false`） |
| `MONITOR_INTERVAL_SECONDS` | 警示檢查間隔秒數（預設 `30`） |

**Email 通知（選用）：**

| 變數名稱 | 說明 |
|----------|------|
| `SMTP_HOST` / `SMTP_PORT` | SMTP 伺服器設定 |
| `SMTP_USER` / `SMTP_PASSWORD` | SMTP 認證 |

### 3.3 驗證部署

部署完成後，開啟 Railway 提供的 URL：

```bash
# 健康檢查
curl https://your-app.up.railway.app/health
# → {"status": "ok", "service": "stock-advisory-tracker", "version": "0.5.0"}

# 監控狀態（確認 6 個排程工作）
curl https://your-app.up.railway.app/api/monitor/status
```

### 3.4 設定 LINE Bot Webhook

1. 前往 [LINE Developers Console](https://developers.line.biz)
2. Messaging API Channel → 取得 **Channel Access Token**（長效）與 **Channel Secret**
3. 設定 Webhook URL：`https://your-app.up.railway.app/webhook/line`
4. 開啟 **Use webhook**，關閉 **Auto-reply messages**

### 3.5 設定 Telegram Bot Webhook

1. 跟 [@BotFather](https://t.me/BotFather) 發送 `/newbot` 取得 Bot Token
2. 在瀏覽器設定 Webhook：
   ```
   https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook?url=https://your-app.up.railway.app/webhook/telegram
   ```
3. 驗證：`https://api.telegram.org/bot<YOUR_TOKEN>/getWebhookInfo`

---

## 第四步：部署前端到 Vercel

### 4.1 既有 Vercel 專案

推送 master 後 Vercel 會自動觸發重新部署。

### 4.2 設定環境變數

在 Vercel → Settings → Environment Variables：

| 變數名稱 | 說明 |
|----------|------|
| `VITE_SUPABASE_URL` | Supabase URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key（前端 RLS 用） |
| `VITE_BACKEND_URL` | Railway 後端 URL |

> Vite 環境變數必須以 `VITE_` 開頭才能在前端存取。

### 4.3 Auth 設定（Supabase）

1. Supabase Dashboard → Authentication → URL Configuration
2. **Site URL** 設為 Vercel 正式網址
3. **Redirect URLs** 加入 Vercel 網址
4. 若使用 Google 登入：在 Google Cloud Console 授權重新導向 URI 加入 Vercel 網址

---

## 第五步：設定 GitHub Actions Secrets（備援用）

GitHub Actions 作為 Railway 的備援排程，Railway 正常時會自動跳過。

前往 GitHub → Settings → Secrets and variables → Actions：

| Secret 名稱 | 說明 |
|-------------|------|
| `VITE_SUPABASE_URL` | Supabase 專案 URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service Role Key |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Bot Token |
| `LINE_ALERT_TARGET_ID` | LINE 推送目標 ID |
| `RAILWAY_BACKEND_URL` | Railway URL（health check 用） |
| `OPENCLAW_GATEWAY_URL` | OpenClaw URL（舊版備援通知，選用） |
| `OPENCLAW_GATEWAY_TOKEN` | OpenClaw Token（選用） |
| `NOTIFICATION_TARGET_ID` | OpenClaw 目標 ID（選用） |

備援排程時間：
- `0 7 * * 1-5` UTC（TST 15:00）→ 台股收盤備援，比 Railway 的 14:05 晚約 1 小時
- `0 22 * * 1-5` UTC（TST 06:00）→ 美股收盤備援，比 Railway 的 05:30 晚約 30 分鐘

---

## 第六步：端到端驗證

### 6.1 後端 API 測試

```bash
BACKEND=https://your-app.up.railway.app

# 健康檢查
curl $BACKEND/health

# 監控狀態（確認 6 個排程工作都在）
curl $BACKEND/api/monitor/status

# 測試投顧通知解析
curl -X POST $BACKEND/api/parse \
  -H "Content-Type: application/json" \
  -d '{"text": "億光（2393）目標價：最小漲幅68~69.5元，合理漲幅75~77元。防守價53元。"}'

# 手動觸發即時報價更新
curl -X POST $BACKEND/api/prices/realtime-refresh

# 月報預覽（不發送）
curl -X POST $BACKEND/api/report/generate
```

### 6.2 前端功能測試

1. 登入後切換到「投顧追蹤」頁面
2. 貼上測試通知文字 → 點擊「解析通知」→ 確認解析結果
3. 勾選股票 → 匯入 → 確認追蹤清單出現
4. 切換到「設定」→ 確認通知設定頁面載入
5. 檢查「管理後台」（管理員帳號）→ 確認使用者管理功能

### 6.3 LINE / Telegram Bot 測試

**LINE：**
- 加 Bot 好友 → 傳送 `/幫助` → 應回覆指令列表
- 傳送 `/追蹤` → 應回覆追蹤清單

**Telegram：**
- 搜尋 Bot → 傳送 `/start` → 應回覆歡迎訊息
- 傳送 `/status` → 應回覆系統狀態與排程工作資訊

---

## 常見問題

### Railway 建置失敗

確認 **Root Directory** 設為 `backend`，Railway 需在此找到 `Dockerfile`。

### 前端連不到後端（CORS 錯誤）

確認 Railway 環境變數 `FRONTEND_URL` 設為正確的 Vercel 網址（含 `https://`）。

### 股價顯示「休市」但實際開盤中

若 Fugle/Finnhub WS 未啟用，twstock 輪詢備援（每 90 秒）會接管。
確認 `FUGLE_ENABLED` 或 `FUGLE_API_KEY` 已正確設定，或等待備援輪詢執行。

### LINE Bot Webhook 驗證失敗

確認 `LINE_CHANNEL_SECRET` 正確。LINE 用 HMAC-SHA256 驗證每個 Webhook。

### 排程工作沒有執行

查看 Railway Logs，搜尋 `Stock monitor started`。確認 `SUPABASE_SERVICE_ROLE_KEY` 已設定。

### Supabase RLS 阻擋查詢

後端使用 `service_role_key`（繞過 RLS），前端使用 `anon_key`（受 RLS 限制）。
確認所有遷移檔已依序執行完成。

### `npm run build` 出現 EPERM 錯誤（Windows OneDrive）

Windows + OneDrive 環境下 `dist/` 資料夾可能被鎖定。
改用 `npx tsc --noEmit` 做型別檢查即可，Vercel 會自行執行建置。
