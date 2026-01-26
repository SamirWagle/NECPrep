"""
Test Supabase connection
"""
import requests
import time

SUPABASE_URL = "https://nusaritkuawppgqgvkno.supabase.co"
ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51c2FyaXRrdWF3cHBncWd2a25vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkyNTM5NTksImV4cCI6MjA4NDgyOTk1OX0.Y1mun6K2W3MKyXc3ND0dw-qEZXhd93ZbumS63rT2NRc"

print(f"Testing connection to: {SUPABASE_URL}")
print("-" * 50)

# Test 1: Ping the REST API
try:
    print("1. Testing REST API...")
    start = time.time()
    response = requests.get(
        f"{SUPABASE_URL}/rest/v1/topics",
        headers={
            "apikey": ANON_KEY,
            "Authorization": f"Bearer {ANON_KEY}"
        },
        timeout=10
    )
    elapsed = time.time() - start
    print(f"   ✅ Status: {response.status_code}")
    print(f"   ⏱️  Time: {elapsed:.2f}s")
    if response.status_code == 200:
        data = response.json()
        print(f"   📊 Topics found: {len(data)}")
    else:
        print(f"   ❌ Response: {response.text}")
except Exception as e:
    print(f"   ❌ Error: {e}")

# Test 2: Check if URL is reachable
try:
    print("\n2. Testing basic connectivity...")
    start = time.time()
    response = requests.get(SUPABASE_URL, timeout=5)
    elapsed = time.time() - start
    print(f"   ✅ Reachable")
    print(f"   ⏱️  Time: {elapsed:.2f}s")
except Exception as e:
    print(f"   ❌ Error: {e}")

print("\n" + "=" * 50)
print("If you see timeouts or errors above, check:")
print("1. Your internet connection")
print("2. Firewall/antivirus blocking Supabase")
print("3. VPN interfering with connection")
