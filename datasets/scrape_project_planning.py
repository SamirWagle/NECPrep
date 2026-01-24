"""
Scrape just the Project Planning, Design and Implementation chapter
"""

import json
import time
import os
import asyncio
from playwright.async_api import async_playwright

BASE_URL = "https://simplequiz.bloggernepal.com/quiz/nepal-engineering-council-registration-examination/computer-engineering"
CHAPTER_SLUG = "project-planning-design-and-implementation"
CHAPTER_NAME = "Project Planning, Design and Implementation"


async def get_max_pages(page, chapter_url):
    """Get maximum number of pages for a chapter"""
    await page.goto(chapter_url, wait_until="networkidle", timeout=60000)
    await asyncio.sleep(3)
    
    try:
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
                    const qTextEl = card.querySelector('.text-2xl.text-justify.font-bold');
                    
                    if (!qTextEl) continue;
                    
                    const questionText = qTextEl.innerText.trim();
                    
                    const inputs = card.querySelectorAll('input[type="radio"]');
                    const options = [];
                    
                    for (const input of inputs) {
                        const value = input.getAttribute('value');
                        const id = input.getAttribute('id');
                        
                        const label = card.querySelector(`label[for="${id}"]`);
                        let optionText = value;
                        if (label) {
                            optionText = label.innerText.trim().replace(/^[a-d]\\. /, '');
                        }
                        
                        options.push(optionText);
                    }
                    
                    if (questionText && options.length >= 4) {
                        questions.push({
                            qsns: questionText,
                            opt1: options[0] || '',
                            opt2: options[1] || '',
                            opt3: options[2] || '',
                            opt4: options[3] || '',
                            correct_option: '',
                            correct_option_index: 0
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


async def main():
    print(f"Scraping: {CHAPTER_NAME}")
    print("="*60)
    
    output_dir = os.path.join(os.path.dirname(__file__), "extracted_questions")
    os.makedirs(output_dir, exist_ok=True)
    
    async with async_playwright() as p:
        print("Launching browser...")
        browser = await p.chromium.launch(headless=False)
        page = await browser.new_page()
        
        chapter_url = f"{BASE_URL}/{CHAPTER_SLUG}"
        
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
                await page.goto(url, wait_until="networkidle", timeout=60000)
                await asyncio.sleep(3)
                
                questions = await extract_questions_from_page(page)
                print(f"  Found {len(questions)} questions")
                
                all_questions.extend(questions)
                
            except Exception as e:
                print(f"Error on page {page_num}: {e}")
        
        await browser.close()
        
        # Save chapter data
        output_file = os.path.join(output_dir, f"{CHAPTER_SLUG}.json")
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(all_questions, f, indent=2, ensure_ascii=False)
        
        print(f"\n{'='*60}")
        print(f"Saved {len(all_questions)} questions to {output_file}")
        print("="*60)
        
        # Update the all_questions.json file
        all_questions_file = os.path.join(output_dir, "all_questions.json")
        if os.path.exists(all_questions_file):
            with open(all_questions_file, 'r', encoding='utf-8') as f:
                all_data = json.load(f)
            
            all_data[CHAPTER_SLUG] = {
                "name": CHAPTER_NAME,
                "questions": all_questions,
                "count": len(all_questions)
            }
            
            with open(all_questions_file, 'w', encoding='utf-8') as f:
                json.dump(all_data, f, indent=2, ensure_ascii=False)
            
            print(f"Updated {all_questions_file}")
            
            # Print total
            total = sum(ch.get("count", 0) for ch in all_data.values())
            print(f"\nTotal questions across all chapters: {total}")


if __name__ == "__main__":
    asyncio.run(main())
