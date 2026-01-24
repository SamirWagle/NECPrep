"""
NEC Computer Engineering Quiz Scraper
Extracts quiz questions from simplequiz.bloggernepal.com
"""

import json
import time
import os
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options
from selenium.common.exceptions import TimeoutException, NoSuchElementException

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
        "pages": 10  # Will be updated dynamically
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


def setup_driver():
    """Setup Chrome driver with options"""
    chrome_options = Options()
    # chrome_options.add_argument("--headless")  # Uncomment for headless mode
    chrome_options.add_argument("--disable-gpu")
    chrome_options.add_argument("--no-sandbox")
    chrome_options.add_argument("--disable-dev-shm-usage")
    chrome_options.add_argument("--window-size=1920,1080")
    
    driver = webdriver.Chrome(options=chrome_options)
    return driver


def get_max_pages(driver, chapter_url):
    """Dynamically get the maximum number of pages for a chapter"""
    driver.get(chapter_url)
    time.sleep(2)
    
    try:
        # Look for pagination links
        pagination_links = driver.find_elements(By.CSS_SELECTOR, "a[href*='page=']")
        if pagination_links:
            page_numbers = []
            for link in pagination_links:
                href = link.get_attribute("href")
                if "page=" in href:
                    try:
                        page_num = int(href.split("page=")[-1].split("&")[0])
                        page_numbers.append(page_num)
                    except:
                        pass
            if page_numbers:
                return max(page_numbers)
    except Exception as e:
        print(f"Error getting max pages: {e}")
    
    return 1  # Default to 1 page


def extract_questions_from_page(driver):
    """Extract questions from the current page"""
    questions = []
    
    try:
        # Wait for questions to load
        WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, ".question, .quiz-question, [class*='question']"))
        )
        time.sleep(1)
    except TimeoutException:
        print("Timeout waiting for questions to load")
    
    # Try multiple selectors to find questions
    question_selectors = [
        ".question-card",
        ".quiz-question",
        ".question-container",
        "[class*='question']",
        ".card",
        "form .card",
        ".quiz-item"
    ]
    
    question_elements = []
    for selector in question_selectors:
        elements = driver.find_elements(By.CSS_SELECTOR, selector)
        if elements:
            question_elements = elements
            print(f"Found {len(elements)} elements with selector: {selector}")
            break
    
    if not question_elements:
        # Try to find by looking at structure
        print("Trying alternative approach...")
        # Get page source and look for patterns
        page_source = driver.page_source
        
        # Try to find questions using JavaScript
        try:
            result = driver.execute_script("""
                // Try to find question data in the page
                let questions = [];
                
                // Look for any data attributes or embedded JSON
                const scripts = document.querySelectorAll('script');
                for (let script of scripts) {
                    if (script.innerHTML.includes('question') || script.innerHTML.includes('quiz')) {
                        console.log(script.innerHTML.substring(0, 500));
                    }
                }
                
                // Common quiz element patterns
                const cards = document.querySelectorAll('.card, [class*="quiz"], [class*="question"]');
                for (let card of cards) {
                    let text = card.innerText;
                    if (text && text.length > 20) {
                        questions.push({
                            html: card.outerHTML,
                            text: text
                        });
                    }
                }
                
                return questions;
            """)
            
            if result:
                print(f"JavaScript found {len(result)} potential question elements")
                for item in result:
                    print(f"Text snippet: {item.get('text', '')[:100]}...")
                    
        except Exception as e:
            print(f"JavaScript extraction failed: {e}")
    
    # Parse each question element
    for idx, q_elem in enumerate(question_elements):
        try:
            question_data = parse_question_element(q_elem, idx)
            if question_data:
                questions.append(question_data)
        except Exception as e:
            print(f"Error parsing question {idx}: {e}")
    
    return questions


def parse_question_element(element, idx):
    """Parse a question element to extract question and options"""
    try:
        # Get the full text content
        full_text = element.text
        
        # Try to find question text
        question_text = ""
        question_selectors = [
            ".question-text",
            ".question-title", 
            "h3",
            "h4",
            "p.question",
            ".card-title"
        ]
        
        for selector in question_selectors:
            try:
                q_elem = element.find_element(By.CSS_SELECTOR, selector)
                question_text = q_elem.text.strip()
                if question_text:
                    break
            except NoSuchElementException:
                continue
        
        if not question_text:
            # Take first line or paragraph
            lines = full_text.split('\n')
            question_text = lines[0].strip() if lines else ""
        
        # Find options
        options = []
        option_selectors = [
            ".option",
            ".answer",
            ".choice",
            "label",
            "input[type='radio'] + label",
            ".form-check-label",
            "li"
        ]
        
        for selector in option_selectors:
            try:
                opt_elements = element.find_elements(By.CSS_SELECTOR, selector)
                if opt_elements and len(opt_elements) >= 4:
                    options = [opt.text.strip() for opt in opt_elements[:4]]
                    break
            except:
                continue
        
        # Find correct answer
        correct_option = ""
        correct_index = 0
        
        correct_selectors = [
            ".correct",
            "[data-correct='true']",
            ".is-correct",
            ".right-answer"
        ]
        
        for selector in correct_selectors:
            try:
                correct_elem = element.find_element(By.CSS_SELECTOR, selector)
                correct_option = correct_elem.text.strip()
                if correct_option in options:
                    correct_index = options.index(correct_option) + 1
                break
            except NoSuchElementException:
                continue
        
        # Build question object
        if question_text and len(options) >= 4:
            return {
                "qsns": question_text,
                "opt1": options[0] if len(options) > 0 else "",
                "opt2": options[1] if len(options) > 1 else "",
                "opt3": options[2] if len(options) > 2 else "",
                "opt4": options[3] if len(options) > 3 else "",
                "correct_option": correct_option,
                "correct_option_index": correct_index
            }
    except Exception as e:
        print(f"Error in parse_question_element: {e}")
    
    return None


def scrape_chapter(driver, chapter_slug, chapter_info, output_dir):
    """Scrape all questions from a chapter"""
    chapter_name = chapter_info["name"]
    print(f"\n{'='*60}")
    print(f"Scraping: {chapter_name}")
    print(f"{'='*60}")
    
    chapter_url = f"{BASE_URL}/{chapter_slug}"
    
    # Get actual max pages
    max_pages = get_max_pages(driver, chapter_url)
    print(f"Found {max_pages} pages")
    
    all_questions = []
    
    for page in range(1, max_pages + 1):
        if page == 1:
            url = chapter_url
        else:
            url = f"{chapter_url}?page={page}"
        
        print(f"\nPage {page}/{max_pages}: {url}")
        
        try:
            driver.get(url)
            time.sleep(2)  # Wait for page to load
            
            questions = extract_questions_from_page(driver)
            print(f"Extracted {len(questions)} questions from page {page}")
            
            all_questions.extend(questions)
            
        except Exception as e:
            print(f"Error on page {page}: {e}")
    
    # Save chapter data
    output_file = os.path.join(output_dir, f"{chapter_slug}.json")
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(all_questions, f, indent=2, ensure_ascii=False)
    
    print(f"\nSaved {len(all_questions)} questions to {output_file}")
    
    return all_questions


def main():
    """Main scraping function"""
    print("NEC Computer Engineering Quiz Scraper")
    print("="*60)
    
    # Create output directory
    output_dir = os.path.join(os.path.dirname(__file__), "extracted_questions")
    os.makedirs(output_dir, exist_ok=True)
    
    # Setup driver
    print("Setting up Chrome driver...")
    driver = setup_driver()
    
    all_data = {}
    
    try:
        for chapter_slug, chapter_info in CHAPTERS.items():
            try:
                questions = scrape_chapter(driver, chapter_slug, chapter_info, output_dir)
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
        
    finally:
        driver.quit()
        print("\nBrowser closed.")


if __name__ == "__main__":
    main()
