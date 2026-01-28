const { Client } = require("@notionhq/client");
const { NotionToMarkdown } = require("notion-to-md");
const fs = require("fs");
const axios = require("axios");
const path = require("path");
const slugify = require("slugify");

// Config
const secret = process.env.NOTION_TOKEN;
const rawPageIds = process.env.NOTION_PAGE_ID;

if (!secret || !rawPageIds) {
  console.error("Error: Missing NOTION_TOKEN or NOTION_PAGE_ID.");
  process.exit(1);
}

// Tách chuỗi ID thành danh sách
const pageIds = rawPageIds.split(",").map(id => id.trim());

const notion = new Client({ auth: secret });
const n2m = new NotionToMarkdown({ notionClient: notion });

// --- 1. HÀM TẢI ẢNH ---
async function downloadImage(url, filename) {
  const dir = "images";
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);

  const filePath = path.join(dir, filename);
  const writer = fs.createWriteStream(filePath);

  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream'
  });

  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

// Custom Transformer cho ẢNH
n2m.setCustomTransformer('image', async (block) => {
  const { image } = block;
  const imageUrl = image.file?.url || image.external?.url;
  const caption = image.caption.length ? image.caption[0].plain_text : "image";
  const cleanCaption = slugify(caption, { lower: true, strict: true }) || "img";
  const uniqueName = `${cleanCaption}_${block.id.slice(0, 5)}.png`;

  try {
    await downloadImage(imageUrl, uniqueName);
    return `![${caption}](./images/${uniqueName})`; 
  } catch (error) {
    return `![${caption}](${imageUrl})`;
  }
});

// Custom Transformer cho TOÁN
n2m.setCustomTransformer('equation', async (block) => {
  const { equation } = block;
  return `\n$$\n${equation.expression}\n$$\n`;
});

// --- 2. HÀM XỬ LÝ THÔNG MINH (Page & Database) ---
async function backupPage(id) {
  console.log(`\n--- Processing ID: ${id} ---`);
  let title = "Untitled";
  let isDatabase = false;

  try {
    // THỬ CÁCH 1: Coi nó là Page
    try {
        const pageData = await notion.pages.retrieve({ page_id: id });
        const titleProp = Object.values(pageData.properties).find(p => p.type === 'title');
        title = titleProp?.title[0]?.plain_text || "Untitled";
    } catch (error) {
        // Nếu lỗi bảo là "Validation Error" (nghĩa là nó là Database), thì thử cách 2
        if (error.code === 'validation_error') {
            console.log("  -> Detected as Database. Switching mode...");
            isDatabase = true;
            const dbData = await notion.databases.retrieve({ database_id: id });
            // Database lưu title khác với Page
            title = dbData.title[0]?.plain_text || "Untitled_Database";
        } else {
            throw error; // Nếu lỗi khác (ví dụ sai quyền) thì ném lỗi ra ngoài
        }
    }
    
    // Tạo tên file
    const safeTitle = slugify(title, { replacement: '_', remove: /[*+~.()'"!:@]/g });
    const fileName = `${safeTitle}.md`;

    console.log(`Found "${title}" -> Saving to: ${fileName}`);

    // Convert sang Markdown
    // (Lưu ý: n2m.pageToMarkdown vẫn hoạt động với Database ID, nó sẽ list các page con ra)
    const mdblocks = await n2m.pageToMarkdown(id);
    let mdString = n2m.toMarkdownString(mdblocks);
    
    // Nếu là Database, thêm một dòng chú thích ở đầu file
    if (isDatabase) {
        mdString.parent = `# Database: ${title}\n\n(Danh sách các trang con)\n\n` + mdString.parent;
    }
    
    // Lưu file
    fs.writeFileSync(fileName, mdString.parent);
    console.log(`✅ Success!`);
    
  } catch (error) {
    console.error(`❌ Failed to backup ID ${id}:`, error.body || error.message);
  }
}

// --- CHẠY VÒNG LẶP ---
(async () => {
  console.log(`Found ${pageIds.length} items to backup.`);
  for (const id of pageIds) {
    await backupPage(id);
  }
  console.log("\n🎉 All operations completed.");
})();
