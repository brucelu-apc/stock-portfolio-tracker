# 部署指南 — 台美股投顧追蹤工具

> 版本：v0.4.0
> 更新日期：2026/02/12

---

## 架構總覽

```
┌────────────┐     ┌─────────────┐     ┌──────────────┐
│  Vercel    │     │  Railway    │     │  Supabase    │
│  (前端)    │────▶│  (後端 API) │────▶│  (PostgreSQL)│
│  React SPA │     │  FastAPI    │     │  Auth + RLS  │
└────────────┘     └──────┬──────┘     └──────────────┘
                          │
                   ┌──────┴──────┐
                   │  APScheduler│
                   │  4 排程工作  │
                   └──────┬──────┘
                          │
              ┌───────────┼───────────┐
              ▼           ▼           ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │  LINE    │ │ Telegram │ │  twstock  │
        │  Bot     │ │  Bot     │ │  yfinance │
        └──────────┘ └──────────┘ └──────────┘
```

---

## 第一步：推送程式碼到 GitHub

目前所有新增/修改的檔案都在本地，尚未 commit。需要推送到遠端：

```bash
cd stock-portfolio-tracker

# 查看變動
git status

# 加入所有新檔案
git add backend/
git add src/components/advisory/
git add src/components/settings/MessagingSettings.tsx
git add src/services/backend.ts
git add src/hooks/
git add supabase/migrations/002_advisory_tables.sql
git add IMPLEMENTATION_LOG.md
git add DEPLOYMENT_GUIDE.md

# 加入修改的既有檔案
git add .github/workflows/market-update.yml
git add src/App.tsx
git add src/components/common/Navbar.tsx
git add src/components/settings/SettingsPage.tsx

# 提交
git commit -m "feat: 投顧通知追蹤系統 v0.4.0

- Phase 1: 通知解析器 + FastAPI 後端骨架
- Phase 2: 台美股價監控引擎 (APScheduler + twstock + yfinance)
- Phase 3: LINE Messaging API 整合 (webhook + push)
- Phase 4: Telegram Bot + 股票轉發功能
- Phase 5: 月報遷移到 Railway、GitHub Actions 備援化、歷史面板、響應式優化"

# 推送
git push origin master
```

---

## 第二步：Supabase 資料庫遷移

### 方法 A：透過 Supabase Dashboard（推薦）

1. 登入 [Supabase Dashboard](https://supabase.com/dashboard)
2. 選擇你的專案
3. 前往 **SQL Editor**
4. 將 `supabase/migrations/002_advisory_tables.sql` 的內容貼上
5. 點擊 **Run**

### 方法 B：透過 Supabase CLI

```bash
# 安裝 CLI（如果尚未安裝）
npm install -g supabase

# 連結專案
supabase link --project-ref <YOUR_PROJECT_REF>

# 執行遷移
supabase db push
```

### 驗證遷移成功

在 SQL Editor 執行：

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```

應該要看到這 7 張新表：
- `advisory_tracking`
- `forward_logs`
- `forward_targets`
- `advisory_notifications`
- `price_alerts`
- `price_targets`
- `user_messaging`

---

## 第三步：部署後端到 Railway

### 3.1 建立 Railway 專案

1. 登入 [Railway](https://railway.app)
2. 點擊 **New Project** → **Deploy from GitHub repo**
3. 選擇 `brucelu-apc/stock-portfolio-tracker`
4. **Root Directory** 設為 `backend`（重要！）
5. Railway 會自動偵測 `Dockerfile` 並建置

### 3.2 設定環境變數

在 Railway 專案的 **Variables** 頁面新增：

| 變數名稱 | 值 | 說明 |
|----------|-----|------|
| `SUPABASE_URL` | `https://xxxxx.supabase.co` | Supabase 專案 URL |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJxxxxxx` | Settings → API → service_role key |
| `FRONTEND_URL` | `https://stock-portfolio-tracker.vercel.app` | Vercel 前端網址 |
| `LINE_CHANNEL_ACCESS_TOKEN` | (見 3.4) | LINE Bot Channel Access Token |
| `LINE_CHANNEL_SECRET` | (見 3.4) | LINE Bot Channel Secret |
| `TELEGRAM_BOT_TOKEN` | (見 3.5) | Telegram Bot Token |
| `PORT` | `8000` | Railway 會自動設定，但建議明確指定 |

### 3.3 驗證部署

部署完成後，開啟 Railway 提供的 URL：

```
https://your-app.up.railway.app/health
```

應該返回：

```json
{"status": "ok", "service": "stock-advisory-tracker", "version": "0.4.0"}
```

查看監控狀態：

```
https://your-app.up.railway.app/api/monitor/status
```

### 3.4 設定 LINE Bot（Phase 3）

1. 前往 [LINE Developers Console](https://developers.line.biz)
2. 建立 Messaging API Channel（或使用既有的）
3. 取得：
   - **Channel Access Token**（長效）
   - **Channel Secret**
4. 設定 Webhook URL：
   ```
   https://your-app.up.railway.app/api/line/webhook
   ```
5. 開啟 **Use webhook** 開關
6. 關閉 **Auto-reply messages**

### 3.5 設定 Telegram Bot（Phase 4）

1. 在 Telegram 跟 [@BotFather](https://t.me/BotFather) 對話
2. 發送 `/newbot`，取得 Bot Token
3. 設定 Webhook（在瀏覽器開啟）：
   ```
   https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook?url=https://your-app.up.railway.app/api/telegram/webhook
   ```
4. 驗證：
   ```
   https://api.telegram.org/bot<YOUR_TOKEN>/getWebhookInfo
   ```

---

## 第四步：部署前端到 Vercel

### 4.1 既有 Vercel 專案更新

如果你的 Vercel 已經連結 GitHub repo，推送 master 後會自動部署。

### 4.2 設定環境變數

在 Vercel → Settings → Environment Variables 新增/確認：

| 變數名稱 | 值 | 說明 |
|----------|-----|------|
| `VITE_SUPABASE_URL` | `https://xxxxx.supabase.co` | Supabase URL |
| `VITE_SUPABASE_ANON_KEY` | `eyJxxxxxx` | Settings → API → anon key |
| `VITE_BACKEND_URL` | `https://your-app.up.railway.app` | Railway 後端 URL |

> 注意：Vite 環境變數必須以 `VITE_` 開頭才能在前端存取。

### 4.3 觸發重新部署

如果環境變數有更動：
1. 前往 Vercel → Deployments
2. 點擊最新一筆 → **Redeploy**

---

## 第五步：設定 GitHub Actions Secrets

GitHub Actions 作為備援排程，需要這些 Secrets：

前往 GitHub → Settings → Secrets and variables → Actions → **New repository secret**

| Secret 名稱 | 說明 |
|-------------|------|
| `VITE_SUPABASE_URL` | Supabase 專案 URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service Role Key |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Bot Token |
| `LINE_ALERT_TARGET_ID` | LINE 推送目標 ID |
| `RAILWAY_BACKEND_URL` | Railway 後端 URL（用於 health check） |
| `OPENCLAW_GATEWAY_URL` | OpenClaw URL（既有備援通知） |
| `OPENCLAW_GATEWAY_TOKEN` | OpenClaw Token |
| `NOTIFICATION_TARGET_ID` | OpenClaw 目標 ID |

---

## 第六步：端到端驗證

### 6.1 後端 API 測試

```bash
BACKEND=https://your-app.up.railway.app

# 健康檢查
curl $BACKEND/health

# 監控狀態
curl $BACKEND/api/monitor/status

# 測試解析
curl -X POST $BACKEND/api/parse \
  -H "Content-Type: application/json" \
  -d '{"text": "億光（2393）目標價：最小漲幅68~69.5元，合理漲幅75~77元。防守價53元。"}'

# 月報預覽（不發送）
curl -X POST $BACKEND/api/report/generate
```

### 6.2 前端功能測試

1. 開啟 Vercel 前端網址
2. 登入後，切換到「投顧追蹤」頁面
3. 貼上測試通知文字 → 點擊「解析通知」
4. 確認解析結果顯示正確
5. 勾選股票 → 匯入
6. 確認追蹤清單出現新匯入的股票
7. 切換到「設定」→ 確認通知設定頁面載入

### 6.3 LINE Bot 測試

1. 加 LINE Bot 好友
2. 傳送 `/幫助` → 應回覆指令列表
3. 傳送 `/追蹤` → 應回覆追蹤清單
4. 直接貼上通知文字 → 應自動解析並回覆結果

### 6.4 Telegram Bot 測試

1. 開啟 Telegram 搜尋你的 Bot
2. 傳送 `/start` → 應回覆歡迎訊息
3. 傳送 `/status` → 應回覆系統狀態

---

## 常見問題

### Railway 建置失敗

確認 Root Directory 設為 `backend`，不是專案根目錄。Railway 需要在 `backend/` 下找到 `Dockerfile`。

### 前端連不到後端 (CORS 錯誤)

確認 Railway 環境變數 `FRONTEND_URL` 設為正確的 Vercel 網址（含 `https://`），且 `main.py` 的 CORS allow_origins 包含該網址。

### LINE Bot Webhook 驗證失敗

確認 `LINE_CHANNEL_SECRET` 正確。LINE 會用 HMAC-SHA256 簽名驗證每個 Webhook 請求。

### 排程工作沒有執行

查看 Railway 的 Logs，搜尋 `APScheduler` 或 `Stock monitor started`。如果沒看到，檢查 Supabase 環境變數是否設定。

### Supabase RLS 阻擋查詢

後端使用 `service_role_key`（繞過 RLS），前端使用 `anon_key`（受 RLS 限制）。確認 002 遷移中的 RLS policies 已正確執行。
