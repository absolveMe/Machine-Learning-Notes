import os
import time
import requests
import json
import sys

# Config
TOKEN = os.environ.get("NOTION_TOKEN")
FILE_TOKEN = os.environ.get("NOTION_FILE_TOKEN")
PAGE_ID = os.environ.get("NOTION_SPACE_ID") # We are using the Page ID here

if not TOKEN or not PAGE_ID:
    print("Error: Missing variables.")
    sys.exit(1)

headers = {
    "Cookie": f"token_v2={TOKEN}; file_token={FILE_TOKEN}",
    "Content-Type": "application/json",
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
                    "locale": "en",
                    "includeContents": "no_files" # Change to 'everything' if you want images
                }
            }
        }
    }
    response = requests.post(url, headers=headers, json=payload)
    response.raise_for_status()
    task_id = response.json().get('taskId')
    print(f"Export requested. Task ID: {task_id}")
    return task_id

def get_download_link(task_id):
    print("Waiting for export to finish...")
    url = "https://www.notion.so/api/v3/getTasks"
    payload = {"taskIds": [task_id]}
    
    # Wait loop
    for _ in range(30): # Timeout after 5 minutes (30 * 10s)
        response = requests.post(url, headers=headers, json=payload)
        response.raise_for_status()
        result = response.json()['results'][0]
        
        state = result.get('state')
        print(f"Current state: {state}")
        
        if state == 'success':
            # In exportBlock, the URL is often inside 'status' -> 'exportURL'
            download_url = result.get('status', {}).get('exportURL')
            
            if download_url:
                return download_url
            else:
                print("Success reported, but no URL found yet. Retrying...")
                
        elif state == 'failure':
            print("Export failed!")
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
