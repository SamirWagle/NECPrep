from supabase import create_client

supabase = create_client(
    'https://nusaritkuawppgqgvkno.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51c2FyaXRrdWF3cHBncWd2a25vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkyNTM5NTksImV4cCI6MjA4NDgyOTk1OX0.Y1mun6K2W3MKyXc3ND0dw-qEZXhd93ZbumS63rT2NRc'
)

ch1 = supabase.table('questions').select('*', count='exact').eq('topic_id', 'chapter-1').limit(5).execute()
print(f'✅ Chapter-1 has {ch1.count} questions')
print(f'\nSample questions:')
for q in ch1.data[:3]:
    print(f"  - {q['question_text'][:60]}...")
