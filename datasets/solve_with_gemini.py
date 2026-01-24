import asyncio
import json
import csv
import os
import time
from playwright.async_api import async_playwright


# Configuration
INPUT_DIR = r"c:\Users\samir\Desktop\EngineeringLisenseProject\extracted_questions"
OUTPUT_DIR = r"c:\Users\samir\Desktop\EngineeringLisenseProject\solved_questions"
CHUNK_SIZE = 20

async def solve_questions():
    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR)

    # Get all JSON files from input directory
    files = [f for f in os.listdir(INPUT_DIR) if f.endswith('.json') and f != "all_questions.json" and "solved" not in f]
    
    print(f"Found {len(files)} chapters to solve: {files}")

    # Launch Browser ONCE for all chapters
    user_data_dir = os.path.join(os.getcwd(), "chrome_profile")
    os.makedirs(user_data_dir, exist_ok=True)
    
    print(f"Launching Chrome with profile at: {user_data_dir}")
    
    async with async_playwright() as p:
        browser = await p.chromium.launch_persistent_context(
            user_data_dir,
            headless=False,
            channel="chrome",
            args=["--start-maximized", "--disable-blink-features=AutomationControlled"],
            viewport=None
        )
        
        if len(browser.pages) > 0:
            page = browser.pages[0]
        else:
            page = await browser.new_page()

        print("Navigating to Gemini...")
        try:
            await page.goto("https://gemini.google.com/app", timeout=60000)
        except Exception as e:
            print(f"Navigation warning: {e}")

        print("Waiting for chat interface... Please log in MANUALLY if prompted.")
        try:
            await page.wait_for_selector("div[contenteditable='true']", timeout=120000)
            print("Chat interface detected. Starting solver...")
        except:
            print("Timed out waiting for login.")
            await browser.close()
            return

        # Process each file
        for filename in files:
            input_path = os.path.join(INPUT_DIR, filename)
            output_json_path = os.path.join(OUTPUT_DIR, filename)
            output_csv_path = os.path.join(OUTPUT_DIR, filename.replace('.json', '.csv'))
            
            print(f"\n{'='*50}\nProcessing Chapter: {filename}\n{'='*50}")

            with open(input_path, 'r', encoding='utf-8') as f:
                questions = json.load(f)

            if not questions:
                print(f"Skipping empty file: {filename}")
                continue

            # Check if already partially solved
            solved_questions = []
            start_index = 0
            if os.path.exists(output_json_path):
                try:
                    with open(output_json_path, 'r', encoding='utf-8') as f:
                        solved_temp = json.load(f)
                        # Basic check: if we have explanations, it's processed
                        count_solved = sum(1 for q in solved_temp if q.get('explanation'))
                        if count_solved > 0:
                            questions = solved_temp # Resume using current state
                            start_index = count_solved // CHUNK_SIZE * CHUNK_SIZE # Approximate resume point
                            print(f"Resuming {filename} from index {start_index}...")
                except:
                    pass

            total_questions = len(questions)
            
            for i in range(start_index, total_questions, CHUNK_SIZE):
                chunk = questions[i : i + CHUNK_SIZE]
                chunk_indices = range(i, i + len(chunk))
                
                print(f"  Chunk {i+1} to {min(i+CHUNK_SIZE, total_questions)}...")

                prompt_data = []
                for idx, q in zip(chunk_indices, chunk):
                    # Skip if already has explanation (resume logic)
                    if q.get('explanation'):
                        continue
                        
                    prompt_data.append({
                        "id": idx,
                        "question": q["qsns"],
                        "options": [q["opt1"], q["opt2"], q["opt3"], q["opt4"]]
                    })
                
                if not prompt_data:
                    continue

                prompt_text = (
                    "You are an expert engineering exam tutor. Solve the following multiple choice questions.\n"
                    "For each question:\n"
                    "1. Select the correct option text exactly as it appears in the options list.\n"
                    "2. specificy the 1-based index (1, 2, 3, or 4) of the correct option.\n"
                    "3. Provide a short explanation.\n"
                    "4. Return ONLY a pure JSON list. No images. No markdown. No introductory text.\n"
                    "Format: [{\"id\": <id>, \"correct_option\": \"<text>\", \"correct_option_index\": <1-4>, \"explanation\": \"<text>\"}, ...]\n\n"
                    f"Questions:\n{json.dumps(prompt_data)}"
                )

                # Retry loop
                max_retries = 3
                for attempt in range(max_retries):
                    try:
                        input_box = await page.wait_for_selector("div[contenteditable='true']")
                        await input_box.fill(prompt_text)
                        await page.keyboard.press("Enter")
                        
                        await asyncio.sleep(5)
                        
                        print(f"  Waiting for answer (Attempt {attempt+1}/{max_retries})...")
                        prev_text = ""
                        stable_count = 0
                        
                        for _ in range(30): # Wait up to ~60s
                            await asyncio.sleep(2)
                            response_text = await page.evaluate("""() => {
                                const responses = document.querySelectorAll('message-content');
                                if (responses.length === 0) return "";
                                const lastResponse = responses[responses.length - 1];
                                return lastResponse.innerText;
                            }""")
                            
                            if response_text and len(response_text) > 50 and response_text == prev_text:
                                stable_count += 1
                                if stable_count >= 2: # Faster check
                                    break
                            else:
                                stable_count = 0
                            
                            prev_text = response_text
                            
                        # Parse JSON
                        try:
                            clean_text = prev_text.strip()
                            # Clean potential markdown wrappers
                            if clean_text.startswith("```json"): clean_text = clean_text[7:]
                            if clean_text.startswith("```"): clean_text = clean_text[3:]
                            if clean_text.endswith("```"): clean_text = clean_text[:-3]
                            clean_text = clean_text.strip()
                            
                            start_bracket = clean_text.find('[')
                            end_bracket = clean_text.rfind(']')
                            
                            if start_bracket != -1 and end_bracket != -1:
                                json_str = clean_text[start_bracket : end_bracket+1]
                                answers = json.loads(json_str)
                                
                                count_updated = 0
                                for ans in answers:
                                        qid = ans.get("id")
                                        if isinstance(qid, int) and 0 <= qid < len(questions):
                                            q = questions[qid]
                                            c_opt = ans.get('correct_option', "").strip()
                                            
                                            # Update answer text
                                            q['correct_option'] = c_opt
                                            q['explanation'] = ans.get('explanation', "")
                                            
                                            # Calculate Index if missing or 0
                                            idx = ans.get('correct_option_index', 0)
                                            if idx == 0:
                                                # Try to find index by matching text
                                                opts = [q["opt1"], q["opt2"], q["opt3"], q["opt4"]]
                                                for i, opt in enumerate(opts):
                                                    if opt.strip() == c_opt:
                                                        idx = i + 1
                                                        break
                                            
                                            q['correct_option_index'] = idx
                                            
                                            count_updated += 1
                                
                                print(f"  Updated {count_updated} questions.")
                                break # Breaking retry loop on success
                            else:
                                print(f"  Could not find JSON list brackets (Attempt {attempt+1}).")
                                if attempt < max_retries - 1:
                                    print("  Retrying...")
                                    continue # Retry

                        except json.JSONDecodeError:
                            print(f"  Failed to parse JSON response (Attempt {attempt+1}).")
                            if attempt < max_retries - 1:
                                print("  Retrying...")
                                continue # Retry

                        # Save progress (only if success or last attempt)
                        with open(output_json_path, 'w', encoding='utf-8') as f:
                            json.dump(questions, f, indent=2, ensure_ascii=False)
                        
                        # Update CSV
                        write_csv(questions, output_csv_path)
                        
                        if start_bracket != -1: # Double check success before leaving
                             break

                    except Exception as e:
                        print(f"  Error: {e}")
                        if attempt < max_retries - 1:
                             input("Press Enter to continue/retry after fixing browser state...")
                    
                await asyncio.sleep(5) # Pause between chunks

        print("Done processing all chapters!")


def write_csv(data, filepath):
    if not data:
        return
    
    headers = ["qsns", "opt1", "opt2", "opt3", "opt4", "correct_option", "explanation"]
    
    with open(filepath, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=headers, extrasaction='ignore')
        writer.writeheader()
        for row in data:
            writer.writerow(row)

if __name__ == "__main__":
    asyncio.run(solve_questions())
