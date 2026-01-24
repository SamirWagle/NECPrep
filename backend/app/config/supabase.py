"""
Supabase client configuration
"""
import os
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_ANON_KEY:
    raise ValueError("Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables")

# Public client (respects RLS)
supabase: Client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)

# Admin client (bypasses RLS) - for seeding and admin operations
supabase_admin: Client | None = None
if SUPABASE_SERVICE_KEY:
    supabase_admin = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
