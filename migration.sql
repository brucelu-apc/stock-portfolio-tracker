-- ================================================================
-- Migration: 3 New Features for Stock Dango
-- 1. Announcements (公告視窗)
-- 2. Advisory access permission (投顧追蹤權限)
-- 3. Registration info + admin email config (註冊增強)
-- ================================================================
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- ================================================================

-- ─── 1. Announcements table ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS announcements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read announcements
CREATE POLICY "Authenticated users can read announcements"
  ON announcements FOR SELECT
  USING (auth.role() = 'authenticated');

-- Only admins can create/update/delete
CREATE POLICY "Admins can insert announcements"
  ON announcements FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Admins can update announcements"
  ON announcements FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Admins can delete announcements"
  ON announcements FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );


-- ─── 2. Advisory access permission ──────────────────────────────

-- Add can_access_advisory column to user_profiles
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS can_access_advisory BOOLEAN NOT NULL DEFAULT false;


-- ─── 3a. User registration info ─────────────────────────────────

CREATE TABLE IF NOT EXISTS user_registration_info (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id),
  display_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE user_registration_info ENABLE ROW LEVEL SECURITY;

-- Users can read and insert/update their own record
CREATE POLICY "Users can read own registration info"
  ON user_registration_info FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own registration info"
  ON user_registration_info FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own registration info"
  ON user_registration_info FOR UPDATE
  USING (auth.uid() = user_id);

-- Admins can read all registration info
CREATE POLICY "Admins can read all registration info"
  ON user_registration_info FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );


-- ─── 3b. Admin email notification config ────────────────────────

CREATE TABLE IF NOT EXISTS admin_email_config (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE admin_email_config ENABLE ROW LEVEL SECURITY;

-- Only admins can manage
CREATE POLICY "Admins can read email config"
  ON admin_email_config FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Admins can insert email config"
  ON admin_email_config FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Admins can update email config"
  ON admin_email_config FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Admins can delete email config"
  ON admin_email_config FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );


-- ─── Done ───────────────────────────────────────────────────────
-- After running this migration, remember to:
-- 1. Set SMTP env vars in Railway (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS)
-- 2. Add at least one admin email in the admin panel
-- 3. Toggle can_access_advisory for users who need advisory page access
