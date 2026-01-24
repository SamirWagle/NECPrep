"""
NEC Quiz Answer Scraper - Improved Version with "Got It" handling
Submits quizzes and captures correct answers from the results page
"""

import json
import time
import os
import asyncio
from playwright.async_api import async_playwright

BASE_URL = "https://simplequiz.bloggernepal.com/quiz/nepal-engineering-council-registration-examination/computer-engineering"

CHAPTERS = {
    "model-question": {"name": "Model Question"},
    "concept-of-basic-electrical-and-electronics-engineering": {"name": "Concept of Basic Electrical and Electronics Engineering"},
    "digital-logic-and-microprocessor": {"name": "Digital Logic and Microprocessor"},
    "programming-language-and-its-application": {"name": "Programming Language and Its Application"},
    "computer-organization-and-embedded-system": {"name": "Computer Organization and Embedded System"},
    "concept-of-computer-network-and-network-security-system": {"name": "Concept of Computer Network and Network Security System"},
    "theory-of-computation-and-computer-graphics": {"name": "Theory of Computation and Computer Graphics"},
    "data-structures-and-algorithm-database-system-and-operating-system": {"name": "Data Structures and Algorithm, Database System and Operating System"},
    "software-engineering-and-object-oriented-analysis-and-design": {"name": "Software Engineering and Object-Oriented Analysis and Design"},
    "artificial-intelligence-and-neural-networks": {"name": "Artificial Intelligence and Neural Networks"},
    "project-planning-design-and-implementation": {"name": "Project Planning, Design and Implementation"}
}


async def get_max_pages(page, chapter_url):
    """Get maximum number of pages for a chapter"""
    await page.goto(chapter_url, wait_until="networkidle", timeout=60000)
    await asyncio.sleep(2)
    
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


async def submit_quiz_and_get_answers(page, url):
    """Submit quiz with first options selected and extract correct answers from results"""
    
    # Navigate to the quiz page
    await page.goto(url, wait_until="networkidle", timeout=60000)
    await asyncio.sleep(2)
    
    # First extract all questions BEFORE submitting
    initial_questions = await page.evaluate("""
        () => {
            const questions = [];
            const cards = document.querySelectorAll('.bg-white.p-12.rounded-lg.shadow-lg.w-full.my-4');
            
            for (const card of cards) {
                const qTextEl = card.querySelector('.text-2xl.text-justify.font-bold');
                if (!qTextEl) continue;
                
                const questionText = qTextEl.innerText.trim();
                const inputs = card.querySelectorAll('input[type="radio"]');
                const options = [];
                
                for (const input of inputs) {
                    const id = input.getAttribute('id');
                    const label = card.querySelector(`label[for="${id}"]`);
                    let optionText = input.getAttribute('value') || '';
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
                        opt4: options[3] || ''
                    });
                }
            }
            return questions;
        }
    """)
    
    # Select first option for each question
    await page.evaluate("""
        () => {
            // Select first option for each question
            const cards = document.querySelectorAll('.bg-white.p-12.rounded-lg.shadow-lg.w-full.my-4');
            for (const card of cards) {
                const firstInput = card.querySelector('input[type="radio"]');
                if (firstInput) {
                    firstInput.checked = true;
                    firstInput.click();
                }
            }
        }
    """)
    
    await asyncio.sleep(1)
    
    # Submit the form
    try:
        # Try finding and clicking the finish button first
        finish_btn = await page.query_selector('button:has-text("Finish"), input[type="submit"]')
        if finish_btn:
            await finish_btn.click()
        else:
            # Fallback to form submit
            await page.evaluate("""
                () => {
                    const form = document.querySelector('form#cartCheckout') || 
                                 document.querySelector('form[name="cartCheckout"]') ||
                                 document.querySelector('form');
                    if (form) form.submit();
                }
            """)
    except Exception as e:
        print(f"  Form submit error: {e}")
    
    await asyncio.sleep(2)

    # ---------------------------------------------------------
    # HANDLE "GOT IT" / POPUP AFTER SUBMISSION
    # ---------------------------------------------------------
    print("  Checking for 'Got it' popup...")
    try:
        # Wait specifically for elements that might look like a "Got it" button
        # Common selectors for such confirmation dialogs
        got_it_btn = await page.query_selector('text="Got it"')
        if not got_it_btn:
             got_it_btn = await page.query_selector('button:has-text("Got it")')
        if not got_it_btn:
             got_it_btn = await page.query_selector('.swal-button--confirm') # SweetAlert common class
             
        if got_it_btn:
            print("  Found 'Got it' button, clicking...")
            await got_it_btn.click()
            await asyncio.sleep(2) # Wait for modal to close and results to render
        else:
            print("  No 'Got it' button found immediately, checking for generic close/ok buttons...")
            # Sometimes it's "OK" or "Close" or just an icon
            close_btn = await page.query_selector('button:has-text("Close")') or await page.query_selector('button:has-text("OK")')
            if close_btn:
                await close_btn.click()
                await asyncio.sleep(2)

    except Exception as e:
        print(f"  Error handling popup: {e}")

    # Wait for page to be steady
    try:
        await page.wait_for_load_state("networkidle", timeout=10000)
    except:
        pass
    
    
    # Now try to extract correct answers from the results page
    results = await page.evaluate("""
        () => {
            const results = [];
            const cards = document.querySelectorAll('.bg-white.p-12.rounded-lg.shadow-lg.w-full.my-4');
            
            for (const card of cards) {
                try {
                    const qTextEl = card.querySelector('.text-2xl.text-justify.font-bold');
                    if (!qTextEl) continue;
                    
                    const questionText = qTextEl.innerText.trim();
                    const labels = card.querySelectorAll('label');
                    const options = [];
                    let correctOption = '';
                    let correctIndex = 0;
                    
                    for (let i = 0; i < labels.length; i++) {
                        const label = labels[i];
                        let optionText = label.innerText.trim().replace(/^[a-d]\\. /, '');
                        options.push(optionText);
                        
                        // Get computed background color
                        const style = window.getComputedStyle(label);
                        const bgColor = style.backgroundColor;
                        
                        // Check for green shades
                        if (bgColor.includes('187, 247, 208') ||
                            bgColor.includes('220, 252, 231') ||
                            bgColor.includes('134, 239, 172') ||
                            bgColor.includes('74, 222, 128') ||
                            bgColor.includes('34, 197, 94') ||
                            bgColor.includes('22, 163, 74') ||
                            bgColor.includes('21, 128, 61') ||
                            bgColor.includes('16, 185, 129') ||
                            bgColor.includes('5, 150, 105') ||
                            // Check for class names if standard tailwind
                            label.classList.contains('bg-green-100') ||
                            label.classList.contains('bg-green-200') ||
                            label.classList.contains('bg-green-300') ||
                            label.classList.contains('correct')) {
                            correctOption = optionText;
                            correctIndex = i + 1;
                        }
                    }
                    
                    results.push({
                        qsns: questionText,
                        opt1: options[0] || '',
                        opt2: options[1] || '',
                        opt3: options[2] || '',
                        opt4: options[3] || '',
                        correct_option: correctOption,
                        correct_option_index: correctIndex,
                        bg_colors: Array.from(labels).map(l => window.getComputedStyle(l).backgroundColor)
                    });
                } catch (e) {
                    console.error('Error:', e);
                }
            }
            return results;
        }
    """)
    
    # Merge initial questions with results
    final_questions = []
    for i, q in enumerate(initial_questions):
        if i < len(results) and results[i].get('correct_option'):
            q['correct_option'] = results[i]['correct_option']
            q['correct_option_index'] = results[i]['correct_option_index']
        else:
            q['correct_option'] = ''
            q['correct_option_index'] = 0
        final_questions.append(q)
    
    return final_questions, results


async def scrape_chapter_answers(browser, chapter_slug, chapter_info, output_dir):
    """Scrape answers for a chapter by submitting quizzes"""
    chapter_name = chapter_info["name"]
    print(f"\n{'='*60}")
    print(f"Scraping answers: {chapter_name}")
    print(f"{'='*60}")
    
    page = await browser.new_page()
    chapter_url = f"{BASE_URL}/{chapter_slug}"
    
    # Get max pages
    max_pages = await get_max_pages(page, chapter_url)
    print(f"Found {max_pages} pages")
    
    all_questions = []
    debug_info = []
    
    for page_num in range(1, max_pages + 1):
        if page_num == 1:
            url = chapter_url
        else:
            url = f"{chapter_url}?page={page_num}"
        
        print(f"\nPage {page_num}/{max_pages}: Submitting quiz...")
        
        try:
            questions, raw_results = await submit_quiz_and_get_answers(page, url)
            
            with_answers = sum(1 for q in questions if q.get('correct_option'))
            print(f"  Found {len(questions)} questions, {with_answers} with correct answers")
            
            if raw_results and len(raw_results) > 0:
                debug_info.append({
                    "page": page_num,
                    "first_q_bg_colors": raw_results[0].get('bg_colors', [])
                })
            
            all_questions.extend(questions)
            
        except Exception as e:
            print(f"Error on page {page_num}: {e}")
            import traceback
            traceback.print_exc()
    
    await page.close()
    
    # Save chapter data
    output_file = os.path.join(output_dir, f"{chapter_slug}.json")
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(all_questions, f, indent=2, ensure_ascii=False)
    
    # Save debug info
    debug_file = os.path.join(output_dir, f"{chapter_slug}_debug.json")
    with open(debug_file, 'w', encoding='utf-8') as f:
        json.dump(debug_info, f, indent=2, ensure_ascii=False)
    
    total_with_answers = sum(1 for q in all_questions if q.get('correct_option'))
    print(f"\nSaved {len(all_questions)} questions ({total_with_answers} with answers) to {output_file}")
    
    return all_questions


async def main():
    print("="*60)
    print("NEC Quiz Answer Scraper - Got It Handled")
    print("Submitting quizzes to capture correct answers")
    print("="*60)
    
    output_dir = os.path.join(os.path.dirname(__file__), "extracted_questions_with_answers")
    os.makedirs(output_dir, exist_ok=True)
    
    async with async_playwright() as p:
        print("\nLaunching browser...")
        browser = await p.chromium.launch(headless=False)
        
        all_data = {}
        total_questions = 0
        total_with_answers = 0
        
        for chapter_slug, chapter_info in CHAPTERS.items():
            try:
                questions = await scrape_chapter_answers(browser, chapter_slug, chapter_info, output_dir)
                
                with_answers = sum(1 for q in questions if q.get('correct_option'))
                
                all_data[chapter_slug] = {
                    "name": chapter_info["name"],
                    "questions": questions,
                    "count": len(questions),
                    "with_answers": with_answers
                }
                
                total_questions += len(questions)
                total_with_answers += with_answers
                
            except Exception as e:
                print(f"Error scraping chapter {chapter_slug}: {e}")
                import traceback
                traceback.print_exc()
                
                all_data[chapter_slug] = {
                    "name": chapter_info["name"],
                    "questions": [],
                    "count": 0,
                    "with_answers": 0,
                    "error": str(e)
                }
        
        await browser.close()
        
        # Save combined data
        combined_file = os.path.join(output_dir, "all_questions_with_answers.json")
        with open(combined_file, 'w', encoding='utf-8') as f:
            json.dump(all_data, f, indent=2, ensure_ascii=False)
        
        print(f"\n{'='*60}")
        print("SCRAPING COMPLETE!")
        print(f"{'='*60}")
        print(f"Combined data saved to: {combined_file}")
        print(f"\nTotal questions: {total_questions}")
        print(f"Questions with correct answers: {total_with_answers}")
        
        print("\nPer chapter breakdown:")
        for slug, data in all_data.items():
            print(f"  - {data['name']}: {data['count']} questions ({data.get('with_answers', 0)} with answers)")


if __name__ == "__main__":
    asyncio.run(main())
