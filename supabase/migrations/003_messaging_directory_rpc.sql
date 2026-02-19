-- =====================================================
-- Migration 003: Messaging Directory RPC Function
-- =====================================================
-- Creates a SECURITY DEFINER function that allows users
-- to browse all registered LINE/Telegram IDs for use
-- as forward targets. This bypasses RLS on user_messaging
-- safely by only exposing necessary columns.
-- =====================================================

CREATE OR REPLACE FUNCTION public.get_messaging_directory()
RETURNS TABLE (
  user_id UUID,
  email TEXT,
  line_user_id TEXT,
  telegram_chat_id BIGINT,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    um.user_id,
    au.email::TEXT,
    um.line_user_id,
    um.telegram_chat_id,
    um.created_at
  FROM public.user_messaging um
  JOIN auth.users au ON au.id = um.user_id
  WHERE um.line_user_id IS NOT NULL
     OR um.telegram_chat_id IS NOT NULL
  ORDER BY um.created_at DESC;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.get_messaging_directory() TO authenticated;

COMMENT ON FUNCTION public.get_messaging_directory() IS
  'Returns a directory of all registered LINE/Telegram user IDs with associated emails. Used by the forward target dropdown selector.';
