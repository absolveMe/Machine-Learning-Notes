import os
import time
import requests
import json
import sys

# --- Config ---
TOKEN = os.environ.get("NOTION_TOKEN", "").strip()
FILE_TOKEN = os.environ.get("NOTION_FILE_TOKEN", "").strip()
RAW_ID = os.environ.get("NOTION_SPACE_ID", "").strip() # Your Page ID

if not TOKEN or not RAW_ID:
    print("Error: Missing variables. Check your Secrets.")
    sys.exit(1)

headers = {
    "Cookie": f"token_v2={TOKEN}; file_token={FILE_TOKEN}",
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

# --- Helper: Format ID ---
def format_id(uid):
    uid = uid.replace("-", "")
    if len(uid) != 32:
        print(f"Error: Page ID length is {len(uid)}. Expected 32.")
        sys.exit(1)
    return f"{uid[:8]}-{uid[8:12]}-{uid[12:16]}-{uid[16:20]}-{uid[20:]}"

PAGE_ID = format_id(RAW_ID)
print(f"Using Page ID: {PAGE_ID}")

# --- Step 1: Get Space ID ---
def get_space_id(page_id):
    print("Fetching Space ID...")
    url = "https://www.notion.so/api/v3/loadPageChunk"
    payload = {
        "pageId": page_id, "limit": 1,
        "cursor": {"stack": []}, "chunkNumber": 0, "verticalColumns": False
    }
    try:
        r = requests.post(url, headers=headers, json=payload)
        r.raise_for_status()
        data = r.json()
        block_data = data.get('recordMap', {}).get('block', {}).get(page_id, {}).get('value', {})
        space_id = block_data.get('space_id')
        if not space_id:
            print("CRITICAL: Could not find Space ID.")
            sys.exit(1)
        print(f"Found Space ID: {space_id}")
        return space_id
    except Exception as e:
        print(f"Error fetching Space ID: {e}")
        sys.exit(1)

SPACE_ID = get_space_id(PAGE_ID)

# --- Step 2: Try Export Configurations ---
def try_export(config_name, options):
    print(f"\n--- Attempting Config: {config_name} ---")
    url = "https://www.notion.so/api/v3/enqueueTask"
    payload = {
        "task": {
            "eventName": "exportBlock",
            "request": {
                "blockId": PAGE_ID,
                "spaceId": SPACE_ID,
                "recursive": True,
                "exportOptions": options
            }
        }
    }
    
    try:
        response = requests.post(url, headers=headers, json=payload)
        response.raise_for_status()
        task_id = response.json().get('taskId')
        print(f"Success! Task ID: {task_id}")
        return task_id
    except requests.exceptions.HTTPError:
        print(f"Failed (500/400). Notion Response: {response.text}")
        return None

# The 3 Configurations to try
configs = [
    ("A: Markdown + No Files (Fastest)", {
        "exportType": "markdown",
        "timeZone": "America/New_York",
        "locale": "en",
        "includeContents": "no_files"
    }),
    ("B: Markdown + Everything (Standard)", {
        "exportType": "markdown",
        "timeZone": "America/New_York",
        "locale": "en",
        "includeContents": "everything"
    }),
    ("C: HTML (Fallback)", {
        "exportType": "html",
        "timeZone": "America/New_York",
        "locale": "en",
        "includeContents": "no_files"
    })
]

TASK_ID = None
for name, options in configs:
    TASK_ID = try_export(name, options)
    if TASK_ID:
        break # Stop if one works

if not TASK_ID:
    print("\nALL CONFIGURATIONS FAILED. Please check permissions or page type.")
    sys.exit(1)

# --- Step 3: Wait for Download ---
def get_download_link(task_id):
    print("\nWaiting for export to finish...")
    url = "https://www.notion.so/api/v3/getTasks"
    payload = {"taskIds": [task_id]}
    
    for _ in range(40):
        response = requests.post(url, headers=headers, json=payload)
        response.raise_for_status()
        result = response.json()['results'][0]
        state = result.get('state')
        print(f"Current state: {state}")
        
        if state == 'success':
            url = result.get('status', {}).get('exportURL') or result.get('exportURL')
            if url: return url
        elif state == 'failure':
            print("Export failed mid-process!")
            sys.exit(1)
        time.sleep(10)
    print("Timed out.")
    sys.exit(1)

# --- Step 4: Download ---
try:
    dl_link = get_download_link(TASK_ID)
    print(f"Downloading file...")
    with requests.get(dl_link, stream=True) as r:
        r.raise_for_status()
        with open("export.zip", 'wb') as f:
            for chunk in r.iter_content(chunk_size=8192):
                f.write(chunk)
    print("Download complete.")
except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)
