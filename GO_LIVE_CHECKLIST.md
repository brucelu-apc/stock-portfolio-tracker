# 📋 Stock Portfolio Tracker — 上線查檢表

> 版本：v0.5.0 | 更新：2026/03

---

## 🛠️ 第一階段：GitHub 基礎準備

- [ ] **代碼同步**：執行 `git push origin master`，確認最新版本已推送至遠端。
- [ ] **GitHub Secrets 設定**：在 `Settings > Secrets and variables > Actions` 確認以下 Secrets：

  | Secret | 說明 |
  |--------|------|
  | `VITE_SUPABASE_URL` | Supabase 專案 URL |
  | `SUPABASE_SERVICE_ROLE_KEY` | Service Role Key（寫入 DB 用） |
  | `LINE_CHANNEL_ACCESS_TOKEN` | LINE Bot Token（備援通知用） |
  | `LINE_ALERT_TARGET_ID` | LINE 推送目標 ID |
  | `RAILWAY_BACKEND_URL` | Railway 後端 URL（health check 用） |
  | `OPENCLAW_GATEWAY_URL` | OpenClaw URL（舊版備援，選用） |
  | `OPENCLAW_GATEWAY_TOKEN` | OpenClaw Token（選用） |
  | `NOTIFICATION_TARGET_ID` | OpenClaw 目標 ID（選用） |

---

## 🗄️ 第二階段：Supabase 資料庫

- [ ] **遷移執行**：在 Supabase SQL Editor 依序執行所有遷移檔（詳見 `DEPLOYMENT_GUIDE.md`）：
  - `supabase/migrations/001_initial_schema.sql`
  - `supabase/migrations/002_advisory_tables.sql`
  - `supabase/migrations/003_messaging_directory_rpc.sql`
  - `supabase/migrations/004_add_stock_name.sql`
  - `supabase/migrations/004b_backfill_stock_names.sql`
  - `supabase/migrations/005_fix_update_source_constraint.sql`
  - `migration.sql`（公告、投顧權限、註冊強化）
  - `migration_v2.sql`（market_data realtime/close 分離）
- [ ] **RLS 安全策略**：確認所有表皆開啟 Row Level Security。
- [ ] **管理員帳號**：執行 SQL 將帳號提升為 admin（見 `ADMIN_SETUP.md`）。
- [ ] **Auth 設定**：
  - `Site URL` 填入 Vercel 正式網址。
  - `Redirect URLs` 加入 Vercel 正式網址。
  - Google Provider：填入 Google Client ID 與 Secret。

---

## 🚂 第三階段：Railway 後端部署

- [ ] **建立 Railway 專案**：Root Directory 設為 `backend`，使用 Dockerfile 部署。
- [ ] **環境變數設定**（必填）：

  | 變數 | 說明 |
  |------|------|
  | `SUPABASE_URL` | Supabase 專案 URL |
  | `SUPABASE_SERVICE_ROLE_KEY` | Service Role Key |
  | `FRONTEND_URL` | Vercel 前端網址（CORS） |
  | `PORT` | `8000` |

- [ ] **環境變數設定**（通知，至少選一）：

  | 變數 | 說明 |
  |------|------|
  | `TELEGRAM_BOT_TOKEN` | Telegram Bot Token（無配額限制，優先） |
  | `TELEGRAM_DEFAULT_CHAT_ID` | Telegram 預設推送 Chat ID |
  | `LINE_CHANNEL_ACCESS_TOKEN` | LINE Bot Token（500則/月） |
  | `LINE_CHANNEL_SECRET` | LINE Webhook 驗證密鑰 |
  | `LINE_ALERT_TARGET_ID` | LINE 預設推送目標 |

- [ ] **環境變數設定**（即時報價 WS，選用）：

  | 變數 | 說明 |
  |------|------|
  | `FUGLE_API_KEY` + `FUGLE_ENABLED=true` | Fugle 台股 WS（不設定則用 twstock 輪詢） |
  | `FINNHUB_API_KEY` + `FINNHUB_ENABLED=true` | Finnhub 美股 WS（不設定則用 yfinance 輪詢） |

- [ ] **健康檢查**：`GET https://your-app.up.railway.app/health` 回傳 `{"status": "ok"}`。
- [ ] **監控狀態確認**：`GET /api/monitor/status` 顯示 6 個排程工作正常運作。
- [ ] **LINE Webhook 設定**：Webhook URL 設為 `https://your-app.up.railway.app/webhook/line`。
- [ ] **Telegram Webhook 設定**：透過 Telegram API 設定 Webhook URL。

---

## 🚀 第四階段：Vercel 前端部署

- [ ] **匯入或連結 GitHub 倉庫**至 Vercel。
- [ ] **環境變數設定**：

  | 變數 | 說明 |
  |------|------|
  | `VITE_SUPABASE_URL` | Supabase URL |
  | `VITE_SUPABASE_ANON_KEY` | Supabase anon key |
  | `VITE_BACKEND_URL` | Railway 後端 URL |

- [ ] **首次建置**：確認 Build 成功（0 errors）。
- [ ] **Auth redirect 更新**：將 Vercel 正式網址填回 Supabase Site URL 與 Google Console。

---

## ✅ 第五階段：端到端功能驗證

- [ ] **登入功能**：Email 登入 + Google OAuth 均可正常跳轉。
- [ ] **公告 Modal**：登入後顯示最新公告（若有）。
- [ ] **個人資料填寫**：新帳號首次登入彈出個人資料表單。
- [ ] **持股清單**：
  - [ ] 新增持股，確認顯示在清單中。
  - [ ] 行動版水平捲動正常，代碼欄固定（sticky）。
  - [ ] 停利/損欄位在手機上可見。
- [ ] **投顧追蹤**（需 `can_access_advisory = true`）：
  - [ ] 貼上通知文字 → 解析 → 匯入 → 追蹤清單出現。
  - [ ] 分頁功能正常（10/20/50/自訂）。
  - [ ] 表格 scroll 與 sticky 表頭正常。
  - [ ] 轉發功能：設定轉發目標並成功發送。
  - [ ] 歷史面板三個分頁均可查詢。
- [ ] **通知測試**：
  - [ ] Telegram：`/start` 有回應，`/status` 顯示 6 個排程工作。
  - [ ] LINE：`/幫助` 有回應，`/追蹤` 顯示清單。
- [ ] **管理後台**（admin 帳號）：
  - [ ] 使用者管理：可審核申請、調整權限。
  - [ ] 公告編輯：新增公告後前台可見。
  - [ ] Email 設定：可設定管理員通知信箱。
- [ ] **月報預覽**：`POST /api/report/generate`（不帶 send=true）回傳正確報告內容。

---

*Last updated: 2026/03*
