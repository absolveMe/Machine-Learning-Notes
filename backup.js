const { Client } = require("@notionhq/client");
const { NotionToMarkdown } = require("notion-to-md");
const fs = require("fs");

// Config
const secret = process.env.NOTION_TOKEN;
const pageId = process.env.NOTION_PAGE_ID;

if (!secret || !pageId) {
  console.error("Error: Missing NOTION_TOKEN or NOTION_SPACE_ID.");
  process.exit(1);
}

const notion = new Client({ auth: secret });
const n2m = new NotionToMarkdown({ notionClient: notion });

(async () => {
  console.log(`Connecting to Page ID: ${pageId}...`);
  
  try {
    // 1. Convert Page to Markdown
    const mdblocks = await n2m.pageToMarkdown(pageId);
    const mdString = n2m.toMarkdownString(mdblocks);
    
    // 2. Save to file
    const fileName = "Notion_Backup.md";
    fs.writeFileSync(fileName, mdString.parent);
    console.log(`Success! Saved to ${fileName}`);
    
  } catch (error) {
    console.error("Backup Failed:", error.body || error.message);
    process.exit(1);
  }
})();
