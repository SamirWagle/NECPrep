"""
NEC Computer Engineering Quiz Scraper - Using Playwright
Extracts quiz questions from simplequiz.bloggernepal.com

This version uses Playwright which is more reliable than Selenium
"""

import json
import time
import os
import asyncio
from playwright.async_api import async_playwright

# Base URL
BASE_URL = "https://simplequiz.bloggernepal.com/quiz/nepal-engineering-council-registration-examination/computer-engineering"

# All chapters/subcategories
CHAPTERS = {
    "model-question": {
        "name": "Model Question",
        "pages": 11
    },
    "concept-of-basic-electrical-and-electronics-engineering": {
        "name": "Concept of Basic Electrical and Electronics Engineering", 
        "pages": 7
    },
    "digital-logic-and-microprocessor": {
        "name": "Digital Logic and Microprocessor",
        "pages": 10
    },
    "programming-language-and-its-application": {
        "name": "Programming Language and Its Application",
        "pages": 10
    },
    "computer-organization-and-embedded-system": {
        "name": "Computer Organization and Embedded System",
        "pages": 10
    },
    "concept-of-computer-network-and-network-security-system": {
        "name": "Concept of Computer Network and Network Security System",
        "pages": 10
    },
    "theory-of-computation-and-computer-graphics": {
        "name": "Theory of Computation and Computer Graphics",
        "pages": 10
    },
    "data-structures-and-algorithm-database-system-and-operating-system": {
        "name": "Data Structures and Algorithm, Database System and Operating System",
        "pages": 10
    },
    "software-engineering-and-object-oriented-analysis-and-design": {
        "name": "Software Engineering and Object-Oriented Analysis and Design",
        "pages": 10
    },
    "artificial-intelligence-and-neural-networks": {
        "name": "Artificial Intelligence and Neural Networks",
        "pages": 10
    },
    "project-planning-design-and-implementation": {
        "name": "Project Planning, Design and Implementation",
        "pages": 10
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
    """Extract questions from the current page using JavaScript"""
    
    # Take a screenshot for debugging
    # await page.screenshot(path="debug_screenshot.png")
    
    # Try to extract questions using JavaScript
    questions = await page.evaluate("""
        () => {
            const questions = [];
            
            // Common quiz card selectors
            const cardSelectors = [
                '.quiz-card',
                '.question-card', 
                '.card',
                '[class*="quiz"]',
                '[class*="question"]',
                'form .card',
                '.w-full.space-y-4 > div',
                'main .card',
                '.quiz-container > div'
            ];
            
            let cards = [];
            for (const selector of cardSelectors) {
                const elements = document.querySelectorAll(selector);
                if (elements.length > 0) {
                    cards = Array.from(elements);
                    console.log(`Found ${elements.length} with ${selector}`);
                    break;
                }
            }
            
            // Alternative: Look for question patterns in the page
            if (cards.length === 0) {
                // Try to find by structure
                const allDivs = document.querySelectorAll('main div, .container div');
                cards = Array.from(allDivs).filter(div => {
                    const text = div.innerText;
                    // A question likely has options like A), B), C), D) or 1., 2., 3., 4.
                    return text && (
                        (text.includes('A)') && text.includes('B)')) ||
                        (text.includes('1.') && text.includes('2.')) ||
                        div.querySelectorAll('input[type="radio"]').length >= 4
                    );
                });
            }
            
            for (const card of cards) {
                try {
                    // Get question text
                    let questionText = '';
                    const questionSelectors = ['h3', 'h4', '.question-text', 'p:first-child', '.card-title'];
                    
                    for (const qs of questionSelectors) {
                        const qEl = card.querySelector(qs);
                        if (qEl && qEl.innerText.trim().length > 10) {
                            questionText = qEl.innerText.trim();
                            break;
                        }
                    }
                    
                    if (!questionText) {
                        // Use first line of card text
                        const lines = card.innerText.split('\\n').filter(l => l.trim());
                        if (lines.length > 0) {
                            questionText = lines[0].trim();
                        }
                    }
                    
                    // Get options
                    const options = [];
                    const optionSelectors = [
                        'label',
                        '.option',
                        '.answer-choice',
                        'input[type="radio"] + *',
                        '.form-check-label',
                        'li'
                    ];
                    
                    for (const os of optionSelectors) {
                        const optEls = card.querySelectorAll(os);
                        if (optEls.length >= 4) {
                            for (let i = 0; i < 4 && i < optEls.length; i++) {
                                let optText = optEls[i].innerText.trim();
                                // Remove prefix like A), B), 1., 2. etc
                                optText = optText.replace(/^[A-Da-d1-4][.)]\s*/, '');
                                if (optText) {
                                    options.push(optText);
                                }
                            }
                            break;
                        }
                    }
                    
                    // Find correct answer
                    let correctOption = '';
                    let correctIndex = 0;
                    
                    const correctSelectors = [
                        '.correct',
                        '[data-correct="true"]',
                        '.is-correct',
                        '.text-green-500',
                        '.bg-green-100',
                        'input[checked]'
                    ];
                    
                    for (const cs of correctSelectors) {
                        const correctEl = card.querySelector(cs);
                        if (correctEl) {
                            correctOption = correctEl.innerText.trim().replace(/^[A-Da-d1-4][.)]\s*/, '');
                            const idx = options.indexOf(correctOption);
                            if (idx >= 0) {
                                correctIndex = idx + 1;
                            }
                            break;
                        }
                    }
                    
                    // Check for data attributes with correct answer
                    const dataCorrect = card.getAttribute('data-correct-answer') || 
                                       card.getAttribute('data-answer') ||
                                       card.querySelector('[data-correct]')?.getAttribute('data-correct');
                    
                    if (dataCorrect && !correctOption) {
                        correctOption = dataCorrect;
                        const idx = options.findIndex(o => o.toLowerCase().includes(dataCorrect.toLowerCase()));
                        if (idx >= 0) {
                            correctIndex = idx + 1;
                        }
                    }
                    
                    if (questionText && options.length >= 4) {
                        questions.push({
                            qsns: questionText,
                            opt1: options[0] || '',
                            opt2: options[1] || '',
                            opt3: options[2] || '',
                            opt4: options[3] || '',
                            correct_option: correctOption,
                            correct_option_index: correctIndex
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
            await asyncio.sleep(2)  # Wait for dynamic content
            
            questions = await extract_questions_from_page(page)
            print(f"Extracted {len(questions)} questions from page {page_num}")
            
            all_questions.extend(questions)
            
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
    print("NEC Computer Engineering Quiz Scraper (Playwright)")
    print("="*60)
    
    # Create output directory
    output_dir = os.path.join(os.path.dirname(__file__), "extracted_questions")
    os.makedirs(output_dir, exist_ok=True)
    
    async with async_playwright() as p:
        print("Launching browser...")
        browser = await p.chromium.launch(headless=False)  # Set to True for headless
        
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


if __name__ == "__main__":
    asyncio.run(main())
