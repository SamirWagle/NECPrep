"""
Database Seeding Script for Engineering License Exam Prep App
=============================================================

This script seeds the Supabase PostgreSQL database with:
1. Topics from the questions JSON file
2. Questions organized by topic
3. Default mock tests

Prerequisites:
- Python 3.8+
- supabase-py library

Usage:
1. Set your Supabase credentials in the .env file or pass them as arguments
2. Run: python seed.py

Environment Variables:
- SUPABASE_URL: Your Supabase project URL
- SUPABASE_SERVICE_KEY: Your Supabase service role key (NOT the anon key)

Note: Use the service role key for seeding as it bypasses RLS policies.
"""

import os
import sys
import json
import uuid
import argparse
from pathlib import Path
from datetime import datetime

try:
    from supabase import create_client, Client
except ImportError:
    print("Error: supabase-py is not installed.")
    print("Install it with: pip install supabase")
    sys.exit(1)

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # dotenv is optional


# ==================== CONFIGURATION ====================

# Default paths - update these if your structure is different
SCRIPT_DIR = Path(__file__).parent
QUESTIONS_DIR = SCRIPT_DIR / "extracted_questions"
ALL_QUESTIONS_FILE = QUESTIONS_DIR / "all_questions.json"

# Topic slug to display order mapping
TOPIC_ORDER = {
    "model-question": 0,
    "concept-of-basic-electrical-and-electronics-engineering": 1,
    "digital-logic-and-microprocessor": 2,
    "programming-language-and-its-application": 3,
    "computer-organization-and-embedded-system": 4,
    "concept-of-computer-network-and-network-security-system": 5,
    "theory-of-computation-and-computer-graphics": 6,
    "data-structures-and-algorithm-database-system-and-operating-system": 7,
    "software-engineering-and-object-oriented-analysis-and-design": 8,
    "artificial-intelligence-and-neural-networks": 9,
    "project-planning-design-and-implementation": 10,
}

# Mock tests to create
MOCK_TESTS = [
    {
        "name": "Quick Practice Test",
        "description": "A short 20-question test to quickly assess your knowledge.",
        "question_count": 20,
        "duration_minutes": 20,
        "passing_score": 60,
        "is_active": True
    },
    {
        "name": "Standard Practice Test",
        "description": "A standard 50-question test covering all topics.",
        "question_count": 50,
        "duration_minutes": 50,
        "passing_score": 60,
        "is_active": True
    },
    {
        "name": "Full Mock Exam",
        "description": "A comprehensive 100-question exam simulating the real license exam.",
        "question_count": 100,
        "duration_minutes": 120,
        "passing_score": 60,
        "is_active": True
    },
]


# ==================== DATABASE OPERATIONS ====================

class DatabaseSeeder:
    def __init__(self, supabase_url: str, supabase_key: str):
        """Initialize the database seeder with Supabase credentials."""
        self.supabase: Client = create_client(supabase_url, supabase_key)
        self.topic_id_map: dict[str, str] = {}  # Maps topic slug to UUID
        
    def clear_all_data(self) -> None:
        """Clear all existing data from the database."""
        print("\n🗑️  Clearing existing data...")
        
        # Delete in order respecting foreign keys
        tables = [
            "flashcard_progress",
            "bookmarks",
            "user_question_progress",
            "mock_test_attempts",
            "study_sessions",
            "user_settings",
            "questions",
            "mock_tests",
            "topics",
        ]
        
        for table in tables:
            try:
                # Use a filter that matches all rows
                self.supabase.table(table).delete().gte('created_at', '1970-01-01').execute()
                print(f"   ✓ Cleared {table}")
            except Exception as e:
                print(f"   ⚠ Warning clearing {table}: {e}")
    
    def seed_topics(self, topics_data: dict) -> None:
        """Seed topics from the questions data."""
        print("\n📚 Seeding topics...")
        
        topics_to_insert = []
        
        for slug, topic_info in topics_data.items():
            topic_id = str(uuid.uuid4())
            self.topic_id_map[slug] = topic_id
            
            # Count questions for this topic
            question_count = len(topic_info.get("questions", []))
            
            topics_to_insert.append({
                "id": topic_id,
                "name": topic_info["name"],
                "short_name": topic_info["name"][:50],  # Shortened name for display
                "description": f"Questions about {topic_info['name']}",
                "icon": self._get_topic_icon(slug),
                "color": self._get_topic_color(slug),
                "question_count": question_count,
                "data_file": f"{slug}.json",
                "display_order": TOPIC_ORDER.get(slug, 99),
                "created_at": datetime.utcnow().isoformat(),
            })
        
        # Sort by display order
        topics_to_insert.sort(key=lambda x: x["display_order"])
        
        # Insert topics
        result = self.supabase.table("topics").insert(topics_to_insert).execute()
        print(f"   ✓ Inserted {len(result.data)} topics")
        
    def seed_questions(self, topics_data: dict) -> None:
        """Seed questions from the questions data."""
        print("\n❓ Seeding questions...")
        
        total_questions = 0
        
        for slug, topic_info in topics_data.items():
            topic_id = self.topic_id_map.get(slug)
            if not topic_id:
                print(f"   ⚠ Topic not found for slug: {slug}")
                continue
            
            questions = topic_info.get("questions", [])
            if not questions:
                continue
            
            questions_to_insert = []
            
            for i, q in enumerate(questions):
                # Determine correct answer index (0-based)
                correct_index = q.get("correct_option_index", 0)
                if correct_index < 0 or correct_index > 3:
                    correct_index = 0  # Default to first option if invalid
                
                # Determine difficulty based on position in list (simple heuristic)
                if i < len(questions) * 0.3:
                    difficulty = "easy"
                elif i < len(questions) * 0.7:
                    difficulty = "medium"
                else:
                    difficulty = "hard"
                
                # Get the correct option text
                option_map = {0: "opt1", 1: "opt2", 2: "opt3", 3: "opt4"}
                correct_option_text = q.get(option_map.get(correct_index, "opt1"), "")
                
                questions_to_insert.append({
                    "id": str(uuid.uuid4()),
                    "topic_id": topic_id,
                    "question_text": q.get("qsns", ""),
                    "option_1": q.get("opt1", ""),
                    "option_2": q.get("opt2", ""),
                    "option_3": q.get("opt3", ""),
                    "option_4": q.get("opt4", ""),
                    "correct_option": correct_option_text,
                    "correct_option_index": correct_index,
                    "explanation": q.get("correct_option", "") or None,
                    "difficulty": difficulty,
                    "created_at": datetime.utcnow().isoformat(),
                })
            
            # Insert in batches of 500
            batch_size = 500
            for i in range(0, len(questions_to_insert), batch_size):
                batch = questions_to_insert[i:i + batch_size]
                self.supabase.table("questions").insert(batch).execute()
            
            total_questions += len(questions_to_insert)
            print(f"   ✓ Inserted {len(questions_to_insert)} questions for '{topic_info['name']}'")
        
        print(f"\n   📊 Total questions inserted: {total_questions}")
    
    def seed_mock_tests(self) -> None:
        """Seed default mock tests."""
        print("\n📝 Seeding mock tests...")
        
        mock_tests_to_insert = []
        
        for mt in MOCK_TESTS:
            mock_tests_to_insert.append({
                "id": str(uuid.uuid4()),
                **mt,
                "created_at": datetime.utcnow().isoformat(),
            })
        
        result = self.supabase.table("mock_tests").insert(mock_tests_to_insert).execute()
        print(f"   ✓ Inserted {len(result.data)} mock tests")
    
    def update_topic_question_counts(self) -> None:
        """Update question counts for each topic."""
        print("\n🔢 Updating topic question counts...")
        
        for slug, topic_id in self.topic_id_map.items():
            # Count questions for this topic
            result = self.supabase.table("questions").select("id", count="exact").eq("topic_id", topic_id).execute()
            count = result.count or 0
            
            # Update topic
            self.supabase.table("topics").update({"question_count": count}).eq("id", topic_id).execute()
        
        print("   ✓ Updated all topic question counts")
    
    def _get_topic_icon(self, slug: str) -> str:
        """Get an icon name for a topic based on its slug."""
        icons = {
            "model-question": "ClipboardCheck",
            "concept-of-basic-electrical-and-electronics-engineering": "Zap",
            "digital-logic-and-microprocessor": "Cpu",
            "programming-language-and-its-application": "Code",
            "computer-organization-and-embedded-system": "Monitor",
            "concept-of-computer-network-and-network-security-system": "Network",
            "theory-of-computation-and-computer-graphics": "PenTool",
            "data-structures-and-algorithm-database-system-and-operating-system": "Database",
            "software-engineering-and-object-oriented-analysis-and-design": "GitBranch",
            "artificial-intelligence-and-neural-networks": "Brain",
            "project-planning-design-and-implementation": "Calendar",
        }
        return icons.get(slug, "Book")
    
    def _get_topic_color(self, slug: str) -> str:
        """Get a color for a topic based on its slug."""
        colors = {
            "model-question": "#6366f1",
            "concept-of-basic-electrical-and-electronics-engineering": "#f59e0b",
            "digital-logic-and-microprocessor": "#10b981",
            "programming-language-and-its-application": "#3b82f6",
            "computer-organization-and-embedded-system": "#8b5cf6",
            "concept-of-computer-network-and-network-security-system": "#ef4444",
            "theory-of-computation-and-computer-graphics": "#ec4899",
            "data-structures-and-algorithm-database-system-and-operating-system": "#14b8a6",
            "software-engineering-and-object-oriented-analysis-and-design": "#f97316",
            "artificial-intelligence-and-neural-networks": "#06b6d4",
            "project-planning-design-and-implementation": "#84cc16",
        }
        return colors.get(slug, "#6b7280")


# ==================== MAIN EXECUTION ====================

def load_questions_data(file_path: Path) -> dict:
    """Load questions data from JSON file."""
    print(f"\n📂 Loading questions from: {file_path}")
    
    if not file_path.exists():
        raise FileNotFoundError(f"Questions file not found: {file_path}")
    
    with open(file_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    
    # Count topics and questions
    topic_count = len(data)
    question_count = sum(len(topic.get("questions", [])) for topic in data.values())
    
    print(f"   ✓ Found {topic_count} topics with {question_count} total questions")
    
    return data


def main():
    parser = argparse.ArgumentParser(description="Seed the database with questions and topics")
    parser.add_argument("--url", help="Supabase URL", default=os.getenv("SUPABASE_URL"))
    parser.add_argument("--key", help="Supabase service role key", default=os.getenv("SUPABASE_SERVICE_KEY"))
    parser.add_argument("--questions-file", help="Path to questions JSON file", default=str(ALL_QUESTIONS_FILE))
    parser.add_argument("--clear", action="store_true", help="Clear existing data before seeding")
    parser.add_argument("--skip-questions", action="store_true", help="Skip seeding questions")
    parser.add_argument("--skip-mock-tests", action="store_true", help="Skip seeding mock tests")
    
    args = parser.parse_args()
    
    # Validate credentials
    if not args.url:
        print("❌ Error: SUPABASE_URL is required.")
        print("   Set it via environment variable or --url argument")
        sys.exit(1)
    
    if not args.key:
        print("❌ Error: SUPABASE_SERVICE_KEY is required.")
        print("   Set it via environment variable or --key argument")
        print("   Note: Use the service role key, NOT the anon key")
        sys.exit(1)
    
    print("=" * 60)
    print("🚀 Engineering License Exam Database Seeder")
    print("=" * 60)
    
    try:
        # Initialize seeder
        seeder = DatabaseSeeder(args.url, args.key)
        
        # Load questions data
        questions_file = Path(args.questions_file)
        topics_data = load_questions_data(questions_file)
        
        # Clear existing data if requested
        if args.clear:
            seeder.clear_all_data()
        
        # Seed topics
        seeder.seed_topics(topics_data)
        
        # Seed questions
        if not args.skip_questions:
            seeder.seed_questions(topics_data)
            seeder.update_topic_question_counts()
        
        # Seed mock tests
        if not args.skip_mock_tests:
            seeder.seed_mock_tests()
        
        print("\n" + "=" * 60)
        print("✅ Database seeding completed successfully!")
        print("=" * 60)
        
    except FileNotFoundError as e:
        print(f"\n❌ File Error: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
