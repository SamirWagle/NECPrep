# Setup 10 Chapters in Supabase

## Quick Setup

Since you're getting a network error with Python, run the SQL directly in Supabase:

1. Go to your Supabase dashboard: https://supabase.com/dashboard/project/kckndxcmqwqrfsrmrvhc
2. Click on **SQL Editor** in the left sidebar
3. Click **New Query**
4. Copy and paste the entire content from `setup_chapters.sql`
5. Click **Run** (or press Ctrl+Enter)

This will:
- Delete all existing topics
- Create 10 chapters
- Only Chapter 1 will have 587 questions (clickable)
- Chapters 2-10 will show "Coming Soon" (disabled)

## What Changed

The frontend now shows:
- **10 chapters** displayed on the practice page
- **Only Chapter 1 is clickable** (has questions)
- Clicking Chapter 1 shows **3 practice options**: 10, 30, or 50 questions
- Questions are **randomly selected** from the dataset
- Other chapters show "Coming Soon" badge and are disabled

## Next Steps

After running the SQL:
1. Refresh your browser at http://localhost:5173/app/practice
2. You should see all 10 chapters
3. Click on Chapter 1
4. Select how many questions to practice (10, 30, or 50)
