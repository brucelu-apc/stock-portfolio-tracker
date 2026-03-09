# 管理員帳號設定指南 (Admin Setup)

> 更新：2026/03

---

## 步驟 1：建立帳號

在前端頁面使用管理員信箱進行註冊（Email + 密碼，或 Google OAuth）。

預設管理員帳號（可自訂）：
- **帳號**：`sys@stockadmin.tw`
- 首次登入後會彈出個人資料填寫表單（`PersonalInfoModal`），填寫後送出申請。

---

## 步驟 2：透過 SQL 提升為管理員

新帳號預設為「一般使用者（user）」且狀態為「申請中（pending）」。
前往 Supabase **SQL Editor** 執行：

```sql
-- 將指定帳號提升為管理員、啟用狀態，並開啟投顧追蹤功能
UPDATE public.user_profiles
SET
  role = 'admin',
  status = 'enabled',
  can_access_advisory = true
WHERE email = 'sys@stockadmin.tw';
```

> `can_access_advisory = true` 賦予投顧追蹤功能存取權限。
> 後續可在管理後台對其他使用者個別開啟此權限。

---

## 步驟 3：設定管理員通知 Email

管理員可設定一個信箱，用來接收新使用者申請的 Email 通知。

**方式 A：透過管理後台 UI**（推薦）
1. 以管理員帳號登入，點擊導覽列「管理後台」。
2. 切換到「Email 設定」分頁（`AdminEmailConfig`）。
3. 填入接收通知的信箱並儲存。

**方式 B：透過 SQL**
```sql
INSERT INTO public.admin_email_config (notification_email)
VALUES ('your-admin-email@example.com')
ON CONFLICT DO NOTHING;
```

---

## 步驟 4：進入管理後台

登入後在導覽列選擇「管理後台」，可執行：

- **使用者管理**：審核申請中使用者（啟用 / 拒絕 / 停用），調整角色與投顧功能權限。
- **公告管理**：新增 / 修改 / 刪除系統公告，切換顯示狀態。登入使用者會在首頁看到最新公告。
- **Email 設定**：設定接收新使用者申請通知的管理員信箱。

---

## 後台環境變數（SMTP Email 通知，選用）

若需要 Email 通知新使用者申請，需在 Railway 設定 SMTP 相關環境變數：

| 變數 | 說明 |
|------|------|
| `SMTP_HOST` | SMTP 伺服器位址（如 `smtp.gmail.com`） |
| `SMTP_PORT` | SMTP Port（如 `587`） |
| `SMTP_USER` | SMTP 帳號 |
| `SMTP_PASSWORD` | SMTP 密碼或應用程式密碼 |
| `SMTP_FROM` | 寄件者顯示地址 |

> 未設定 SMTP 環境變數時，新申請仍會寫入資料庫，管理員可在後台手動查看，只是不會收到 Email 通知。
