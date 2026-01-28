import os
import time
import requests
import json
import sys

# Config
TOKEN = os.environ.get("NOTION_TOKEN", "").strip()
FILE_TOKEN = os.environ.get("NOTION_FILE_TOKEN", "").strip()
PAGE_ID = os.environ.get("NOTION_SPACE_ID", "").strip() # This is now your Page ID

if not TOKEN or not PAGE_ID:
    print("Error: Missing variables. Check your Secrets.")
    sys.exit(1)

# Mimic a real browser to avoid being blocked
headers = {
    "Cookie": f"token_v2={TOKEN}; file_token={FILE_TOKEN}",
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

def request_export():
    print("Requesting Page Export (Recursive)...")
    url = "https://www.notion.so/api/v3/enqueueTask"
    
    # Simplified Payload (removed problematic settings)
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
        response.raise_for_status() # Check for 500/404 errors
        task_id = response.json().get('taskId')
        print(f"Export requested. Task ID: {task_id}")
        return task_id
    except requests.exceptions.HTTPError as err:
        print(f"HTTP Error: {err}")
        print(f"Server Response: {response.text}") # Print the error details from Notion
        sys.exit(1)

def get_download_link(task_id):
    print("Waiting for export to finish...")
    url = "https://www.notion.so/api/v3/getTasks"
    payload = {"taskIds": [task_id]}
    
    # Wait loop (up to 5 minutes)
    for _ in range(30):
        response = requests.post(url, headers=headers, json=payload)
        response.raise_for_status()
        result = response.json()['results'][0]
        
        state = result.get('state')
        print(f"Current state: {state}")
        
        if state == 'success':
            # Check both possible locations for the URL
            download_url = result.get('status', {}).get('exportURL')
            if not download_url:
                download_url = result.get('exportURL')
            
            if download_url:
                return download_url
            else:
                print("Success reported, but no URL yet. Waiting...")
                
        elif state == 'failure':
            print("Export failed!")
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

# Main execution
try:
    tid = request_export()
    dl_link = get_download_link(tid)
    download_file(dl_link)
except Exception as e:
    print(f"An error occurred: {e}")
    sys.exit(1)
