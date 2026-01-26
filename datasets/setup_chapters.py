"""
Setup 10 chapters in the database
Only Chapter 1 has questions (587 from ch1.json)
"""
import os
from supabase import create_client

# Supabase credentials (CORRECT PROJECT)
url = "https://nusaritkuawppgqgvkno.supabase.co"
key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51c2FyaXRrdWF3cHBncWd2a25vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkyNTM5NTksImV4cCI6MjA4NDgyOTk1OX0.Y1mun6K2W3MKyXc3ND0dw-qEZXhd93ZbumS63rT2NRc"

supabase = create_client(url, key)

# Read the SQL file
with open('setup_chapters.sql', 'r', encoding='utf-8') as f:
    sql_content = f.read()

print("Setting up 10 chapters...")

# Execute the SQL
try:
    # First delete existing topics
    result = supabase.table('topics').delete().neq('id', '').execute()
    print(f"✅ Deleted existing topics")
    
    # Insert new chapters
    chapters = [
        {
            'id': 'chapter-1',
            'name': 'Chapter 1: Basic Electrical & Electronics',
            'short_name': 'Electrical Eng.',
            'description': 'Circuit analysis, semiconductors, and digital electronics. Practice with real exam questions.',
            'icon': 'Zap',
            'color': '#f97316',
            'question_count': 587,
            'data_file': 'ch1.json',
            'display_order': 1
        },
        {
            'id': 'chapter-2',
            'name': 'Chapter 2: Digital Logic & Microprocessor',
            'short_name': 'Digital Logic',
            'description': 'Logic gates, Boolean algebra, and microprocessor architecture',
            'icon': 'Cpu',
            'color': '#3b82f6',
            'question_count': 0,
            'data_file': 'ch2.json',
            'display_order': 2
        },
        {
            'id': 'chapter-3',
            'name': 'Chapter 3: Programming & Applications',
            'short_name': 'Programming',
            'description': 'Programming fundamentals, data structures, and algorithms',
            'icon': 'Code',
            'color': '#8b5cf6',
            'question_count': 0,
            'data_file': 'ch3.json',
            'display_order': 3
        },
        {
            'id': 'chapter-4',
            'name': 'Chapter 4: Computer Networks & Security',
            'short_name': 'Networks',
            'description': 'Network protocols, security systems, and communication',
            'icon': 'Network',
            'color': '#06b6d4',
            'question_count': 0,
            'data_file': 'ch4.json',
            'display_order': 4
        },
        {
            'id': 'chapter-5',
            'name': 'Chapter 5: Database & Operating Systems',
            'short_name': 'DB & OS',
            'description': 'Database management, OS concepts, and system design',
            'icon': 'Database',
            'color': '#10b981',
            'question_count': 0,
            'data_file': 'ch5.json',
            'display_order': 5
        },
        {
            'id': 'chapter-6',
            'name': 'Chapter 6: Software Engineering & OOAD',
            'short_name': 'Software Eng.',
            'description': 'SDLC, UML diagrams, and object-oriented design patterns',
            'icon': 'Settings',
            'color': '#6366f1',
            'question_count': 0,
            'data_file': 'ch6.json',
            'display_order': 6
        },
        {
            'id': 'chapter-7',
            'name': 'Chapter 7: Theory of Computation & Graphics',
            'short_name': 'Theory & Graphics',
            'description': 'Automata, formal languages, and computer graphics fundamentals',
            'icon': 'Brain',
            'color': '#ec4899',
            'question_count': 0,
            'data_file': 'ch7.json',
            'display_order': 7
        },
        {
            'id': 'chapter-8',
            'name': 'Chapter 8: AI & Neural Networks',
            'short_name': 'AI & ML',
            'description': 'Machine learning, neural networks, and AI algorithms',
            'icon': 'Brain',
            'color': '#f59e0b',
            'question_count': 0,
            'data_file': 'ch8.json',
            'display_order': 8
        },
        {
            'id': 'chapter-9',
            'name': 'Chapter 9: Computer Organization',
            'short_name': 'Hardware',
            'description': 'Computer architecture, memory systems, and assembly language',
            'icon': 'HardDrive',
            'color': '#14b8a6',
            'question_count': 0,
            'data_file': 'ch9.json',
            'display_order': 9
        },
        {
            'id': 'chapter-10',
            'name': 'Chapter 10: Project Planning & Design',
            'short_name': 'Project Mgmt.',
            'description': 'Project lifecycle, design methodologies, and implementation',
            'icon': 'ClipboardList',
            'color': '#84cc16',
            'question_count': 0,
            'data_file': 'ch10.json',
            'display_order': 10
        }
    ]
    
    result = supabase.table('topics').insert(chapters).execute()
    print(f"✅ Created 10 chapters")
    print(f"   - Chapter 1: 587 questions (active)")
    print(f"   - Chapters 2-10: 0 questions (coming soon)")
    
except Exception as e:
    print(f"❌ Error: {e}")
