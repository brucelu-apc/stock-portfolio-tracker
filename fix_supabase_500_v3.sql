-- ULTIMATE RESET & FIX (v3) for Supabase Auth 500 Error
-- This script clears all legacy naming conflicts and implements a robust upsert logic.

-- 1. Thoroughly remove ALL old triggers and functions (including legacy name 'handlenewuser')
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS public.handlenewuser() CASCADE;

-- 2. Ensure user_profiles table structure is correct
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    role TEXT DEFAULT 'user',
    status TEXT DEFAULT 'pending',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Create a NEWLY NAMED robust handler function (v3)
-- Uses ON CONFLICT to prevent duplicate key errors that caused 500s
CREATE OR REPLACE FUNCTION public.handle_new_user_v3()
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
END;
$$;

-- 4. Re-attach the trigger to the new v3 function
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user_v3();

-- 5. Final Sync: Ensure all existing users in Auth are in the profiles table
INSERT INTO public.user_profiles (id, email, role, status)
SELECT id, email, 'user', 'pending' FROM auth.users
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
