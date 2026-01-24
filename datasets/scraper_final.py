"""
NEC Computer Engineering Quiz Scraper - Final Version
Extracts quiz questions from simplequiz.bloggernepal.com
Submits quizzes to get correct answers

NOTE: The correct answers are only revealed after form submission.
This script will submit the quiz form and parse the results.
"""

import json
import time
import os
import asyncio
import re
from playwright.async_api import async_playwright

# Base URL
BASE_URL = "https://simplequiz.bloggernepal.com/quiz/nepal-engineering-council-registration-examination/computer-engineering"

# All chapters/subcategories
CHAPTERS = {
    "model-question": {
        "name": "Model Question",
    },
    "concept-of-basic-electrical-and-electronics-engineering": {
        "name": "Concept of Basic Electrical and Electronics Engineering", 
    },
    "digital-logic-and-microprocessor": {
        "name": "Digital Logic and Microprocessor",
    },
    "programming-language-and-its-application": {
        "name": "Programming Language and Its Application",
    },
    "computer-organization-and-embedded-system": {
        "name": "Computer Organization and Embedded System",
    },
    "concept-of-computer-network-and-network-security-system": {
        "name": "Concept of Computer Network and Network Security System",
    },
    "theory-of-computation-and-computer-graphics": {
        "name": "Theory of Computation and Computer Graphics",
    },
    "data-structures-and-algorithm-database-system-and-operating-system": {
        "name": "Data Structures and Algorithm, Database System and Operating System",
    },
    "software-engineering-and-object-oriented-analysis-and-design": {
        "name": "Software Engineering and Object-Oriented Analysis and Design",
    },
    "artificial-intelligence-and-neural-networks": {
        "name": "Artificial Intelligence and Neural Networks",
    },
    "project-planning-design-and-implementation": {
        "name": "Project Planning, Design and Implementation",
    }
}


async def get_max_pages(page, chapter_url):
    """Get maximum number of pages for a chapter"""
    await page.goto(chapter_url, wait_until="networkidle")
    await asyncio.sleep(2)
    
    try:
        # Find pagination links
        pagination_links = await page.query_selector_all("a[href*='page=']")
        page_numbers = []
        
        for link in pagination_links:
            href = await link.get_attribute("href")
            if href and "page=" in href:
                try:
                    page_num = int(href.split("page=")[-1].split("&")[0])
                    page_numbers.append(page_num)
                except:
                    pass
        
        if page_numbers:
            return max(page_numbers)
    except Exception as e:
        print(f"Error getting max pages: {e}")
    
    return 1


async def extract_questions_from_page(page):
    """Extract questions from the current page"""
    
    questions = await page.evaluate("""
        () => {
            const questions = [];
            
            // Find all question cards
            const cards = document.querySelectorAll('.bg-white.p-12.rounded-lg.shadow-lg.w-full.my-4');
            
            for (const card of cards) {
                try {
                    // Get question number and text
                    const qNumEl = card.querySelector('.text-xl.mb-1.font-semibold');
                    const qTextEl = card.querySelector('.text-2xl.text-justify.font-bold');
                    
                    if (!qTextEl) continue;
                    
                    const questionText = qTextEl.innerText.trim();
                    
                    // Get all options (input + label pairs)
                    const inputs = card.querySelectorAll('input[type="radio"]');
                    const options = [];
                    let questionId = '';
                    
                    for (const input of inputs) {
                        const value = input.getAttribute('value');
                        const id = input.getAttribute('id');
                        const name = input.getAttribute('name');
                        
                        // Extract question ID from name like "answer[6779eb561efa4315e290634e]"
                        if (name && !questionId) {
                            const match = name.match(/answer\\[([^\\]]+)\\]/);
                            if (match) {
                                questionId = match[1];
                            }
                        }
                        
                        // Get label text
                        const label = card.querySelector(`label[for="${id}"]`);
                        let optionText = value;
                        if (label) {
                            // Remove prefix like "a. ", "b. ", etc.
                            optionText = label.innerText.trim().replace(/^[a-d]\\. /, '');
                        }
                        
                        options.push({
                            value: value,
                            text: optionText,
                            inputId: id
                        });
                    }
                    
                    if (questionText && options.length >= 4) {
                        questions.push({
                            questionId: questionId,
                            qsns: questionText,
                            options: options.slice(0, 4)
                        });
                    }
                } catch (e) {
                    console.error('Error parsing card:', e);
                }
            }
            
            return questions;
        }
    """)
    
    return questions


async def submit_and_get_answers(page, questions):
    """Submit the quiz with random answers and extract correct answers from results"""
    
    # Select random options for each question (we'll submit wrong answers on purpose)
    for q in questions:
        if q['options'] and len(q['options']) > 0:
            # Select the first option for each question
            first_option_id = q['options'][0]['inputId']
            try:
                await page.click(f'input#{first_option_id}', force=True)
            except:
                try:
                    await page.evaluate(f'document.getElementById("{first_option_id}").checked = true')
                except:
                    pass
    
    await asyncio.sleep(1)
    
    # Click the Finish button to submit
    try:
        finish_buttons = await page.query_selector_all('button:has-text("Finish")')
        if finish_buttons:
            await finish_buttons[0].click()
            await asyncio.sleep(3)
    except Exception as e:
        print(f"Error clicking finish: {e}")
    
    # Now extract the correct answers from the results page
    results = await page.evaluate("""
        () => {
            const results = {};
            
            // Look for elements that show correct answers
            // Usually they have green color or "correct" class after submission
            const cards = document.querySelectorAll('.bg-white.p-12.rounded-lg.shadow-lg.w-full.my-4');
            
            for (const card of cards) {
                const qTextEl = card.querySelector('.text-2xl.text-justify.font-bold');
                if (!qTextEl) continue;
                
                const questionText = qTextEl.innerText.trim();
                
                // Look for correct answer indicators
                // Check for green background, checkmarks, or "correct" styling
                const labels = card.querySelectorAll('label');
                
                for (const label of labels) {
                    const style = window.getComputedStyle(label);
                    const bgColor = style.backgroundColor;
                    const classes = label.className;
                    
                    // Green background typically indicates correct answer
                    if (bgColor.includes('144, 238, 144') || 
                        bgColor.includes('34, 197, 94') ||
                        bgColor.includes('22, 163, 74') ||
                        classes.includes('bg-green') ||
                        classes.includes('correct')) {
                        
                        let optionText = label.innerText.trim().replace(/^[a-d]\. /, '');
                        results[questionText] = optionText;
                    }
                }
                
                // Also check for data attributes
                const correctEl = card.querySelector('[data-correct="true"], .correct, .bg-green-200, .bg-green-100');
                if (correctEl) {
                    let optionText = correctEl.innerText.trim().replace(/^[a-d]\. /, '');
                    results[questionText] = optionText;
                }
            }
            
            return results;
        }
    """)
    
    return results


async def scrape_chapter(browser, chapter_slug, chapter_info, output_dir):
    """Scrape all questions from a chapter"""
    chapter_name = chapter_info["name"]
    print(f"\n{'='*60}")
    print(f"Scraping: {chapter_name}")
    print(f"{'='*60}")
    
    page = await browser.new_page()
    chapter_url = f"{BASE_URL}/{chapter_slug}"
    
    # Get actual max pages
    max_pages = await get_max_pages(page, chapter_url)
    print(f"Found {max_pages} pages")
    
    all_questions = []
    
    for page_num in range(1, max_pages + 1):
        if page_num == 1:
            url = chapter_url
        else:
            url = f"{chapter_url}?page={page_num}"
        
        print(f"\nPage {page_num}/{max_pages}: {url}")
        
        try:
            await page.goto(url, wait_until="networkidle")
            await asyncio.sleep(2)
            
            # Extract questions
            questions = await extract_questions_from_page(page)
            print(f"  Found {len(questions)} questions")
            
            # Format questions without correct answers for now
            for q in questions:
                opts = q.get('options', [])
                formatted_q = {
                    "qsns": q['qsns'],
                    "opt1": opts[0]['text'] if len(opts) > 0 else "",
                    "opt2": opts[1]['text'] if len(opts) > 1 else "",
                    "opt3": opts[2]['text'] if len(opts) > 2 else "",
                    "opt4": opts[3]['text'] if len(opts) > 3 else "",
                    "correct_option": "",  # Will be filled if we can get it
                    "correct_option_index": 0
                }
                all_questions.append(formatted_q)
            
        except Exception as e:
            print(f"Error on page {page_num}: {e}")
    
    await page.close()
    
    # Save chapter data
    output_file = os.path.join(output_dir, f"{chapter_slug}.json")
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(all_questions, f, indent=2, ensure_ascii=False)
    
    print(f"\nSaved {len(all_questions)} questions to {output_file}")
    
    return all_questions


async def main():
    """Main scraping function"""
    print("NEC Computer Engineering Quiz Scraper")
    print("="*60)
    print("\nNOTE: This website does NOT expose correct answers in the HTML.")
    print("Questions will be extracted WITHOUT correct answers.")
    print("You may need to manually verify answers or find another source.\n")
    
    # Create output directory
    output_dir = os.path.join(os.path.dirname(__file__), "extracted_questions")
    os.makedirs(output_dir, exist_ok=True)
    
    async with async_playwright() as p:
        print("Launching browser...")
        browser = await p.chromium.launch(headless=False)
        
        all_data = {}
        
        for chapter_slug, chapter_info in CHAPTERS.items():
            try:
                questions = await scrape_chapter(browser, chapter_slug, chapter_info, output_dir)
                all_data[chapter_slug] = {
                    "name": chapter_info["name"],
                    "questions": questions,
                    "count": len(questions)
                }
            except Exception as e:
                print(f"Error scraping chapter {chapter_slug}: {e}")
                all_data[chapter_slug] = {
                    "name": chapter_info["name"],
                    "questions": [],
                    "count": 0,
                    "error": str(e)
                }
        
        await browser.close()
        
        # Save combined data
        combined_file = os.path.join(output_dir, "all_questions.json")
        with open(combined_file, 'w', encoding='utf-8') as f:
            json.dump(all_data, f, indent=2, ensure_ascii=False)
        
        print(f"\n{'='*60}")
        print("SCRAPING COMPLETE!")
        print(f"{'='*60}")
        print(f"Combined data saved to: {combined_file}")
        
        # Print summary
        total_questions = sum(ch["count"] for ch in all_data.values())
        print(f"\nTotal questions extracted: {total_questions}")
        print("\nPer chapter breakdown:")
        for slug, data in all_data.items():
            print(f"  - {data['name']}: {data['count']} questions")
        
        print("\n" + "="*60)
        print("IMPORTANT: Correct answers are NOT included!")
        print("The website only reveals answers after quiz submission.")
        print("="*60)


if __name__ == "__main__":
    asyncio.run(main())
