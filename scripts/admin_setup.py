import os
import time
from dotenv import load_dotenv
from supabase import create_client, Client

# Load environment variables
load_dotenv()

def setup_admin():
    url = os.getenv("VITE_SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

    if not url or not key:
        print("Error: Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env")
        return

    # Create Supabase client with admin privileges
    supabase: Client = create_client(url, key)

    email = "sys@stockadmin.tw"
    password = "Admin"
    
    print(f"Setting up admin account: {email}")

    # 1. Try to create the user or get existing user
    user_id = None
    try:
        # Check if user already exists
        # There is no direct "get user by email" in public API easily without admin, 
        # but create_user returns error or user.
        # However, supabase-py admin.create_user doesn't throw if exists? Let's check.
        # Actually using admin.list_users is better if feasible, but create_user is the direct way.
        
        # NOTE: supabase-py `auth.admin.create_user` creates a user with confirmed email by default
        user = supabase.auth.admin.create_user({
            "email": email,
            "password": password,
            "email_confirm": True
        })
        user_id = user.user.id
        print(f"User created with ID: {user_id}")
        
    except Exception as e:
        error_msg = str(e).lower()
        if "already" in error_msg and "registered" in error_msg:
            print("User already registered. Fetching user ID...")
            # If user exists, we can't easily get ID from auth.admin without listing.
            # Workaround: List users and filter.
            # list_users returns a list directly in newer versions
            users = supabase.auth.admin.list_users()
            print(f"Debug: Found {len(users)} users in Auth.")
            for u in users:
                print(f" - Checking: {u.email} (ID: {u.id})")
                if u.email.strip().lower() == email.strip().lower():
                    user_id = u.id
                    break
            
            if not user_id:
                print("Error: Could not find existing user ID even though registration said it exists.")
                return
            print(f"Found existing user ID: {user_id}")
        else:
            print(f"Error creating user: {e}")
            return

    # 2. Update user_profiles table (Bypass RLS using service role)
    if user_id:
        print(f"Updating profile for {user_id}...")
        try:
            # Check if profile exists first
            res = supabase.table("user_profiles").select("*").eq("id", user_id).execute()
            
            if not res.data:
                # If profile doesn't exist (trigger failed?), insert it manually
                print("Profile not found, inserting...")
                supabase.table("user_profiles").insert({
                    "id": user_id,
                    "email": email,
                    "role": "admin",
                    "status": "enabled"
                }).execute()
            else:
                # Update existing profile
                supabase.table("user_profiles").update({
                    "role": "admin",
                    "status": "enabled"
                }).eq("id", user_id).execute()
            
            print("Successfully updated user role to 'admin' and status to 'enabled'.")
            
        except Exception as e:
            print(f"Error updating profile: {e}")

if __name__ == "__main__":
    setup_admin()
