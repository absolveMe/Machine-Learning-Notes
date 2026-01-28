import os
import time
import requests
import json
import sys

# Config
TOKEN = os.environ.get("NOTION_TOKEN")
FILE_TOKEN = os.environ.get("NOTION_FILE_TOKEN")
SPACE_ID = os.environ.get("NOTION_SPACE_ID")

if not TOKEN or not SPACE_ID:
    print("Error: Missing NOTION_TOKEN or NOTION_SPACE_ID")
    sys.exit(1)

headers = {
    "Cookie": f"token_v2={TOKEN}; file_token={FILE_TOKEN}",
    "Content-Type": "application/json",
}

def request_export():
    print("Requesting export...")
    url = "https://www.notion.so/api/v3/enqueueTask"
    payload = {
        "task": {
            "eventName": "exportSpace",
            "request": {
                "spaceId": SPACE_ID,
                "exportOptions": {
                    "exportType": "markdown",
                    "timeZone": "America/New_York",
                    "locale": "en",
                    "includeContents": "no_files"
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
    
    while True:
        response = requests.post(url, headers=headers, json=payload)
        response.raise_for_status()
        result = response.json()['results'][0]
        
        state = result.get('state')
        print(f"Current state: {state}")
        
        if state == 'success':
            # --- DEBUG SECTION ---
            print("\n!!! DEBUG: FULL RESPONSE FROM NOTION !!!")
            print(json.dumps(result, indent=2))
            print("!!! END DEBUG !!!\n")
            # ---------------------

            # Try to find the URL in the standard place
            download_url = result.get('status', {}).get('exportURL')
            
            # If not there, try the top level (sometimes happens)
            if not download_url:
                download_url = result.get('exportURL')

            if download_url:
                return download_url
            else:
                print("CRITICAL ERROR: Notion said 'Success' but gave no URL in the usual places.")
                print("Please copy the DEBUG info above and share it.")
                sys.exit(1)
                
        elif state == 'failure':
            print("Export failed!")
            print(json.dumps(result, indent=2))
            sys.exit(1)
        
        time.sleep(10)

def download_file(url):
    print(f"Downloading file from {url[:50]}...")
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
