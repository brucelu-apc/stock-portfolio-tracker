# Stock Portfolio Tracker — 資料庫結構

> 最後更新：2026/03

---

## 核心持股表

### 1. `portfolio_holdings` — 活躍持股

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | UUID | 主鍵 |
| `ticker` | TEXT | 股票代碼（如 2330、AAPL） |
| `region` | TEXT | `'TPE'` 或 `'US'` |
| `name` | TEXT | 股票名稱 |
| `shares` | NUMERIC | 持有股數 |
| `cost_price` | NUMERIC | 平均成本價 |
| `strategy_mode` | TEXT | `'auto'` 或 `'manual'` |
| `high_watermark_price` | NUMERIC | 歷史最高價（trailing stop 用） |
| `user_id` | UUID | 所屬使用者 |

### 2. `market_data` — 全局價格快取

| 欄位 | 型別 | 說明 |
|------|------|------|
| `ticker` | TEXT | 股票代碼（UNIQUE 約束） |
| `current_price` | NUMERIC | 最佳可用價格（警示 + 計算用） |
| `realtime_price` | NUMERIC | 盤中即時價（twstock / WS feeds 寫入） |
| `close_price` | NUMERIC | 官方收盤價（yfinance 寫入） |
| `prev_close` | NUMERIC | 前一收盤價 |
| `updated_at` | TIMESTAMPTZ | 最後同步時間 |

> 特殊 ticker：`USDTWD`（region=`'FX'`）存放美元匯率。
>
> `current_price` 邏輯：盤中取 `realtime_price`，收盤後取 `close_price`，永遠是「最佳可用值」。

### 3. `historical_holdings` — 已售出 / 歸檔

| 欄位 | 型別 | 說明 |
|------|------|------|
| `ticker` | TEXT | 股票代碼 |
| `shares` | NUMERIC | 賣出股數 |
| `cost_price` | NUMERIC | 買入成本 |
| `sell_price` | NUMERIC | 實現賣出價 |
| `fee` | NUMERIC | 手續費 |
| `tax` | NUMERIC | 稅金 |
| `archived_at` | TIMESTAMPTZ | 結算日期 |
| `user_id` | UUID | 所屬使用者 |

---

## 投顧追蹤表（002_advisory_tables.sql）

### 4. `price_targets` — 投顧目標價

| 欄位 | 型別 | 說明 |
|------|------|------|
| `ticker` | TEXT | 股票代碼 |
| `stock_name` | TEXT | 股票名稱 |
| `defense_price` | NUMERIC | 防守價 |
| `min_target_low` / `min_target_high` | NUMERIC | 最小漲幅目標區間 |
| `reasonable_target_low` / `reasonable_target_high` | NUMERIC | 合理漲幅目標區間 |
| `entry_price` | NUMERIC | 建議買進價 |
| `strategy_notes` | TEXT | 策略備註 |
| `is_latest` | BOOLEAN | 是否為最新版本（舊版本設為 false） |
| `notified_at` | TIMESTAMPTZ | 通知日期 |
| `user_id` | UUID | 所屬使用者 |

> 關鍵索引：`idx_price_targets_latest ON price_targets(ticker, is_latest)`

### 5. `advisory_tracking` — 追蹤狀態

| 欄位 | 型別 | 說明 |
|------|------|------|
| `user_id` | UUID | 使用者 |
| `ticker` | TEXT | 股票代碼 |
| `status` | TEXT | `watching` / `entered` / `exited` / `ignored` |

### 6. `price_alerts` — 觸發的價格警示

| 欄位 | 型別 | 說明 |
|------|------|------|
| `ticker` | TEXT | 股票代碼 |
| `alert_type` | TEXT | `defense_breach` / `min_target_reached` / `reasonable_target_reached` |
| `triggered_price` | NUMERIC | 觸發時的股價 |
| `triggered_at` | TIMESTAMPTZ | 觸發時間 |
| `user_id` | UUID | 所屬使用者 |

> 去重機制：同一 ticker + alert_type 24 小時內不重複觸發。
> 關鍵索引：`idx_price_alerts_triggered ON price_alerts(triggered_at DESC)`

### 7. `forward_targets` — 轉發目標

| 欄位 | 型別 | 說明 |
|------|------|------|
| `name` | TEXT | 目標名稱 |
| `platform` | TEXT | `'line'` 或 `'telegram'` |
| `target_id` | TEXT | LINE userId/groupId 或 Telegram chat_id |
| `user_id` | UUID | 所屬使用者 |

### 8. `forward_logs` — 轉發歷史

| 欄位 | 型別 | 說明 |
|------|------|------|
| `forward_target_id` | UUID | FK → forward_targets |
| `tickers` | TEXT[] | 被轉發的股票代碼列表 |
| `forwarded_at` | TIMESTAMPTZ | 轉發時間 |
| `user_id` | UUID | 所屬使用者 |

### 9. `user_messaging` — 使用者通知偏好

| 欄位 | 型別 | 說明 |
|------|------|------|
| `user_id` | UUID | 使用者 |
| `line_user_id` | TEXT | LINE userId |
| `telegram_chat_id` | TEXT | Telegram chat_id |
| `notify_price_alert` | BOOLEAN | 開啟警示通知 |
| `notify_daily_summary` | BOOLEAN | 開啟日摘要 |
| `notify_monthly_report` | BOOLEAN | 開啟月報 |

### 10. `advisory_notifications` — 原始通知備份

| 欄位 | 型別 | 說明 |
|------|------|------|
| `raw_text` | TEXT | 原始通知文字 |
| `message_type` | TEXT | 通知類型 |
| `source` | TEXT | 來源（line/manual 等） |
| `parsed_at` | TIMESTAMPTZ | 解析時間 |

---

## 管理 / 系統表（migration.sql）

### 11. `announcements` — 系統公告

| 欄位 | 型別 | 說明 |
|------|------|------|
| `title` | TEXT | 公告標題 |
| `content` | TEXT | 公告內容 |
| `is_active` | BOOLEAN | 是否顯示 |
| `created_by` | UUID | 建立者（管理員） |

> RLS：所有登入使用者可讀；僅管理員可新增/修改/刪除。

### 12. `user_profiles` — 使用者設定檔

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | UUID | FK → auth.users |
| `email` | TEXT | 電子郵件 |
| `role` | TEXT | `'user'` 或 `'admin'` |
| `status` | TEXT | `'pending'` / `'enabled'` / `'disabled'` |
| `can_access_advisory` | BOOLEAN | 是否有投顧追蹤功能權限 |

### 13. `user_registration_info` — 註冊填寫資訊

| 欄位 | 型別 | 說明 |
|------|------|------|
| `user_id` | UUID | FK → auth.users |
| `display_name` | TEXT | 顯示名稱 |
| `phone` | TEXT | 電話 |
| `company` | TEXT | 公司 |
| `notes` | TEXT | 備註 |

### 14. `admin_email_config` — 管理員 Email 設定

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | UUID | 主鍵 |
| `notification_email` | TEXT | 接收新註冊通知的管理員信箱 |

---

## 遷移檔案清單

| 檔案 | 說明 |
|------|------|
| `supabase/migrations/001_initial_schema.sql` | 初始表結構（holdings、market_data 等） |
| `supabase/migrations/002_advisory_tables.sql` | 7 張投顧追蹤表 + RLS + 索引 |
| `supabase/migrations/003_messaging_directory_rpc.sql` | 通訊錄 RPC 函式 |
| `supabase/migrations/004_add_stock_name.sql` | price_targets 新增 stock_name 欄位 |
| `supabase/migrations/004b_backfill_stock_names.sql` | stock_name 回填腳本 |
| `supabase/migrations/005_fix_update_source_constraint.sql` | update_source 欄位約束修正 |
| `migration.sql` | 公告、投顧權限、註冊強化功能 |
| `migration_v2.sql` | market_data 新增 realtime_price / close_price + UNIQUE 約束 |
