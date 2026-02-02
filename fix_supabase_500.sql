-- Fix for Supabase Auth 500 Error during Signup
-- This script ensures the trigger function handles conflicts and matches the table schema.

-- 1. Redefine the trigger function with conflict handling
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, role, status)
  VALUES (new.id, new.email, 'user', 'pending')
  ON CONFLICT (id) DO UPDATE 
  SET email = EXCLUDED.email,
      updated_at = NOW();
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Ensure trigger is properly attached
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 3. Ensure user_profiles has all required columns
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_profiles' AND column_name='role') THEN
    ALTER TABLE public.user_profiles ADD COLUMN role TEXT DEFAULT 'user';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_profiles' AND column_name='status') THEN
    ALTER TABLE public.user_profiles ADD COLUMN status TEXT DEFAULT 'pending';
  END IF;
END $$;
