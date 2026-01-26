#!/usr/bin/env python3
"""Check if all 10 chapters are in the database"""

from supabase import create_client

SUPABASE_URL = "https://nusaritkuawppgqgvkno.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51c2FyaXRrdWF3cHBncWd2a25vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTI1Mzk1OSwiZXhwIjoyMDg0ODI5OTU5fQ.-lknBthAZh8EP0X9Tod-ZFTkVRSe3A5wZJ3G5czNH8w"

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

print("\n=== CHAPTERS IN DATABASE ===\n")
result = supabase.table('topics').select('id, short_name, question_count').order('display_order').execute()

for topic in result.data:
    status = "✅ ACTIVE" if topic['question_count'] > 0 else "⏳ COMING SOON"
    print(f"{topic['id']:15} | {topic['short_name']:30} | {topic['question_count']:3} questions | {status}")

print(f"\n📊 Total chapters: {len(result.data)}")
print(f"✅ Active chapters: {sum(1 for t in result.data if t['question_count'] > 0)}")
