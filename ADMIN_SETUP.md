# 管理員帳號設定指南 (Admin Setup)

依照您的需求，系統需要一個預設的管理員帳號 `sys@stockadmin.tw`。

### 步驟 1：註冊帳號
請先在前端頁面使用 `sys@stockadmin.tw` 進行註冊。
*   **帳號**: `sys@stockadmin.tw`
*   **初始密碼**: `Admin` (註冊後可登入修改)

### 步驟 2：手動提升為管理員 (SQL)
由於安全性限制，新註冊的帳號預設均為「一般使用者 (user)」且狀態為「申請中 (pending)」。請到 Supabase 的 **SQL Editor** 執行以下指令，將該帳號設定為管理員並啟用：

```sql
-- 將 sys@stockadmin.tw 提升為管理員並啟用狀態
UPDATE public.user_profiles
SET role = 'admin', status = 'enabled'
WHERE email = 'sys@stockadmin.tw';
```

### 步驟 3：進入管理後台
執行完 SQL 後，重新整理網頁登入，您應該會在導覽列看到 **「管理後台」** 選項。

在管理後台，您可以：
1.  查看所有申請中的使用者。
2.  將使用者狀態改為「啟用」、「拒絕」或「停用」。
3.  調整使用者的權限角色。
