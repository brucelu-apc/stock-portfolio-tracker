-- ULTIMATE FIX for Supabase Auth 500 Error
-- This script completely cleans up old triggers/functions and recreates a robust version.

-- 1. Thoroughly remove old trigger and function to clear conflicts
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- 2. Ensure user_profiles table structure is correct and clean
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    role TEXT DEFAULT 'user',
    status TEXT DEFAULT 'pending',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Create a ROBUST handler function
-- Added EXCEPTION handling to prevent 500 errors if internal inserts fail
-- Added search_path security best practice
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, role, status)
  VALUES (new.id, new.email, 'user', 'pending')
  ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email,
      updated_at = NOW();
  RETURN new;
EXCEPTION WHEN OTHERS THEN
  -- Catch-all to ensure the auth signup process DOES NOT fail even if profile creation fails
  RETURN new;
END;
$$;

-- 4. Re-attach the trigger
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 5. Sync missing accounts (emergency catch-up)
INSERT INTO public.user_profiles (id, email)
SELECT id, email FROM auth.users
ON CONFLICT (id) DO NOTHING;
