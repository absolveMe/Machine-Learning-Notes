import os
import time
import requests
import json
import sys

# Config
TOKEN = os.environ.get("NOTION_TOKEN", "").strip()
FILE_TOKEN = os.environ.get("NOTION_FILE_TOKEN", "").strip()
RAW_ID = os.environ.get("NOTION_SPACE_ID", "").strip() # This is your Page ID

if not TOKEN or not RAW_ID:
    print("Error: Missing variables. Check your Secrets.")
    sys.exit(1)

# --- HELPER: Fix Notion ID Format ---
def format_id(uid):
    uid = uid.replace("-", "") # Remove existing dashes
    if len(uid) != 32:
        print(f"Error: The Page ID length is {len(uid)}, but it should be 32 characters.")
        print("Double check you copied the correct part of the URL.")
        sys.exit(1)
    # Re-assemble with dashes: 8-4-4-4-12
    return f"{uid[:8]}-{uid[8:12]}-{uid[12:16]}-{uid[16:20]}-{uid[20:]}"

PAGE_ID = format_id(RAW_ID)
print(f"Using Formatted Page ID: {PAGE_ID}")
# ------------------------------------

headers = {
    "Cookie": f"token_v2={TOKEN}; file_token={FILE_TOKEN}",
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

def request_export():
    print("Requesting Page Export (Recursive)...")
    url = "https://www.notion.so/api/v3/enqueueTask"
    
    payload = {
        "task": {
            "eventName": "exportBlock",
            "request": {
                "blockId": PAGE_ID,
                "recursive": True,
                "exportOptions": {
                    "exportType": "markdown",
                    "timeZone": "America/New_York",
                    "locale": "en"
                }
            }
        }
    }
    
    try:
        response = requests.post(url, headers=headers, json=payload)
        response.raise_for_status()
        task_id = response.json().get('taskId')
        print(f"Export requested. Task ID: {task_id}")
        return task_id
    except requests.exceptions.HTTPError as err:
        print(f"HTTP Error: {err}")
        print(f"Server Response: {response.text}")
        sys.exit(1)

def get_download_link(task_id):
    print("Waiting for export to finish...")
    url = "https://www.notion.so/api/v3/getTasks"
    payload = {"taskIds": [task_id]}
    
    for _ in range(30):
        response = requests.post(url, headers=headers, json=payload)
        response.raise_for_status()
        result = response.json()['results'][0]
        
        state = result.get('state')
        print(f"Current state: {state}")
        
        if state == 'success':
            download_url = result.get('status', {}).get('exportURL')
            if not download_url:
                download_url = result.get('exportURL')
            
            if download_url:
                return download_url
            else:
                print("Success reported, but no URL yet. Waiting...")
                
        elif state == 'failure':
            print("Export failed! Notion Response:")
            print(json.dumps(result, indent=2))
            sys.exit(1)
        
        time.sleep(10)
    
    print("Error: Timed out waiting for export.")
    sys.exit(1)

def download_file(url):
    print(f"Downloading file...")
    local_filename = "export.zip"
    with requests.get(url, stream=True) as r:
        r.raise_for_status()
        with open(local_filename, 'wb') as f:
            for chunk in r.iter_content(chunk_size=8192):
                f.write(chunk)
    print("Download complete.")

try:
    tid = request_export()
    dl_link = get_download_link(tid)
    download_file(dl_link)
except Exception as e:
    print(f"An error occurred: {e}")
    sys.exit(1)
