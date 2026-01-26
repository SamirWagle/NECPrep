"""
Quick Seed Script for Ch1 Questions
Loads questions from ch1.json into Supabase
"""

import json
import os
from supabase import create_client, Client

# Supabase credentials from environment or hardcoded
SUPABASE_URL = os.getenv('SUPABASE_URL', 'https://nusaritkuawppgqgvkno.supabase.co')
SUPABASE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY', '')  # You'll need to provide this

def seed_ch1_questions():
    """Seed questions from ch1.json"""
    
    if not SUPABASE_KEY:
        print("❌ Error: SUPABASE_SERVICE_ROLE_KEY not set")
        print("\nRun this script with:")
        print('python seed_ch1.py')
        print("\nOr set environment variable:")
        print('$env:SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"')
        return
    
    # Initialize Supabase client
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
    print(f"✅ Connected to Supabase: {SUPABASE_URL}")
    
    # Read ch1.json
    json_path = os.path.join('BooksQuestions', 'ch1.json')
    with open(json_path, 'r', encoding='utf-8') as f:
        questions_data = json.load(f)
    
    print(f"📖 Found {len(questions_data)} questions in ch1.json")
    
    # Topic ID for Chapter 1 (updated to match setup_chapters.sql)
    topic_id = 'chapter-1'
    
    # Prepare questions for insertion
    questions_to_insert = []
    for q in questions_data:
        question = {
            'topic_id': topic_id,
            'question_text': q['qsns'],
            'option_1': q['opt1'],
            'option_2': q['opt2'],
            'option_3': q['opt3'],
            'option_4': q['opt4'],
            'correct_option': q['correct_option'],
            'correct_option_index': q['correct_option_index'],
            'difficulty': 'medium'  # Default difficulty
        }
        questions_to_insert.append(question)
    
    print(f"⏳ Inserting {len(questions_to_insert)} questions...")
    
    # Insert in batches of 100
    batch_size = 100
    total_inserted = 0
    
    for i in range(0, len(questions_to_insert), batch_size):
        batch = questions_to_insert[i:i+batch_size]
        try:
            result = supabase.table('questions').insert(batch).execute()
            total_inserted += len(batch)
            print(f"✅ Inserted batch {i//batch_size + 1}: {len(batch)} questions (Total: {total_inserted})")
        except Exception as e:
            print(f"❌ Error inserting batch {i//batch_size + 1}: {e}")
            continue
    
    # Update topic question count
    try:
        supabase.table('topics').update({
            'question_count': total_inserted
        }).eq('id', topic_id).execute()
        print(f"✅ Updated topic '{topic_id}' question_count to {total_inserted}")
    except Exception as e:
        print(f"⚠️ Warning: Could not update topic count: {e}")
    
    print(f"\n🎉 Successfully seeded {total_inserted} questions from ch1.json!")
    print(f"📊 Topic: {topic_id}")

if __name__ == '__main__':
    seed_ch1_questions()
