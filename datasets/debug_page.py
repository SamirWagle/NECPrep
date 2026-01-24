"""
Debug Script to analyze quiz page structure
"""

import asyncio
from playwright.async_api import async_playwright

URL = "https://simplequiz.bloggernepal.com/quiz/nepal-engineering-council-registration-examination/computer-engineering/model-question"

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        page = await browser.new_page()
        
        print(f"Navigating to {URL}")
        await page.goto(URL, wait_until="networkidle")
        await asyncio.sleep(3)
        
        # Take a screenshot
        await page.screenshot(path="debug_screenshot.png")
        print("Screenshot saved to debug_screenshot.png")
        
        # Get the full HTML
        html = await page.content()
        with open("page_source.html", "w", encoding="utf-8") as f:
            f.write(html)
        print("Full HTML saved to page_source.html")
        
        # Analyze the structure
        structure = await page.evaluate("""
            () => {
                const result = {
                    classNames: [],
                    possibleQuestions: [],
                    allButtons: [],
                    forms: []
                };
                
                // Get all unique class names
                const allElements = document.querySelectorAll('*');
                const classSet = new Set();
                for (const el of allElements) {
                    if (el.className && typeof el.className === 'string') {
                        el.className.split(' ').forEach(c => classSet.add(c.trim()));
                    }
                }
                result.classNames = Array.from(classSet).filter(c => c.length > 0).slice(0, 100);
                
                // Find elements that look like questions (have multiple child elements with radio inputs)
                const allDivs = document.querySelectorAll('div, section, article');
                for (const div of allDivs) {
                    const radioInputs = div.querySelectorAll('input[type="radio"]');
                    if (radioInputs.length >= 4) {
                        result.possibleQuestions.push({
                            className: div.className,
                            html: div.outerHTML.substring(0, 2000),
                            radioCount: radioInputs.length
                        });
                    }
                }
                
                // Find all buttons
                const buttons = document.querySelectorAll('button, input[type="submit"], a.btn, [role="button"]');
                result.allButtons = Array.from(buttons).map(b => ({
                    text: b.innerText || b.value || 'N/A',
                    className: b.className,
                    tagName: b.tagName
                })).slice(0, 20);
                
                // Find forms
                const forms = document.querySelectorAll('form');
                result.forms = Array.from(forms).map(f => ({
                    id: f.id,
                    className: f.className,
                    action: f.action,
                    childCount: f.children.length
                }));
                
                return result;
            }
        """)
        
        print("\n" + "="*60)
        print("PAGE STRUCTURE ANALYSIS")
        print("="*60)
        
        print("\n\n--- CLASS NAMES ---")
        print(", ".join(structure['classNames'][:50]))
        
        print("\n\n--- BUTTONS FOUND ---")
        for btn in structure['allButtons']:
            print(f"  {btn['tagName']}: '{btn['text'][:50]}' - {btn['className'][:50]}")
        
        print("\n\n--- FORMS FOUND ---")
        for form in structure['forms']:
            print(f"  ID: {form['id']}, Class: {form['className']}, Children: {form['childCount']}")
        
        print("\n\n--- POSSIBLE QUESTION ELEMENTS ---")
        for i, q in enumerate(structure['possibleQuestions'][:5]):
            print(f"\n  Question Element {i+1}:")
            print(f"    Class: {q['className']}")
            print(f"    Radio inputs: {q['radioCount']}")
            print(f"    HTML Preview: {q['html'][:500]}...")
        
        # Also try to find quiz data in scripts
        script_data = await page.evaluate("""
            () => {
                const scripts = document.querySelectorAll('script');
                const results = [];
                for (const script of scripts) {
                    const content = script.innerHTML;
                    if (content.includes('question') || content.includes('quiz') || content.includes('option')) {
                        results.push(content.substring(0, 3000));
                    }
                }
                return results;
            }
        """)
        
        print("\n\n--- SCRIPT DATA (containing question/quiz/option) ---")
        for i, script in enumerate(script_data):
            print(f"\n  Script {i+1}:")
            print(f"    {script[:1000]}...")
        
        # Save analysis
        with open("structure_analysis.txt", "w", encoding="utf-8") as f:
            f.write("CLASS NAMES:\n")
            f.write(", ".join(structure['classNames']))
            f.write("\n\nBUTTONS:\n")
            for btn in structure['allButtons']:
                f.write(f"  {btn}\n")
            f.write("\n\nFORMS:\n")
            for form in structure['forms']:
                f.write(f"  {form}\n")
            f.write("\n\nQUESTION ELEMENTS:\n")
            for q in structure['possibleQuestions']:
                f.write(f"\n{q['html']}\n{'='*80}\n")
            f.write("\n\nSCRIPT DATA:\n")
            for script in script_data:
                f.write(f"\n{script}\n{'='*80}\n")
        
        print("\nFull analysis saved to structure_analysis.txt")
        
        await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
