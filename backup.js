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

const pageIds = rawPageIds.split(",").map(id => id.trim());
const notion = new Client({ auth: secret });
const n2m = new NotionToMarkdown({ notionClient: notion });

// --- 1. XỬ LÝ ẢNH ---
async function downloadImage(url, filename) {
  const dir = "images";
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  const filePath = path.join(dir, filename);
  const writer = fs.createWriteStream(filePath);
  const response = await axios({ url, method: 'GET', responseType: 'stream' });
  response.data.pipe(writer);
  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

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

n2m.setCustomTransformer('equation', async (block) => {
  return `\n$$\n${block.equation.expression}\n$$\n`;
});

// --- 2. HÀM XỬ LÝ DATABASE (MỚI) ---
async function processDatabase(dbId, dbTitle) {
  console.log(`  -> Querying database content...`);
  
  // Lấy tất cả các trang trong Database
  const response = await notion.databases.query({
    database_id: dbId,
    sorts: [{ property: 'Name', direction: 'ascending' }] // Sắp xếp theo tên
  });

  let fullContent = `# Database: ${dbTitle}\n\n`;
  fullContent += `## Mục lục (${response.results.length} bài viết)\n`;

  // Bước 1: Tạo mục lục
  for (const page of response.results) {
    const titleProp = Object.values(page.properties).find(p => p.type === 'title');
    const pageTitle = titleProp?.title[0]?.plain_text || "Untitled";
    fullContent += `- [${pageTitle}](#${slugify(pageTitle, {lower: true})})\n`;
  }

  fullContent += `\n---\n`;

  // Bước 2: Tải nội dung từng trang con
  for (const page of response.results) {
    const titleProp = Object.values(page.properties).find(p => p.type === 'title');
    const pageTitle = titleProp?.title[0]?.plain_text || "Untitled";
    
    console.log(`    Processing child page: "${pageTitle}"`);
    
    const mdblocks = await n2m.pageToMarkdown(page.id);
    const mdString = n2m.toMarkdownString(mdblocks);
    
    // Thêm nội dung vào file tổng
    fullContent += `\n## ${pageTitle}\n\n`;
    fullContent += mdString.parent + "\n\n---\n";
  }

  return fullContent;
}

// --- 3. HÀM CHÍNH ---
async function backupPage(id) {
  console.log(`\n--- Processing ID: ${id} ---`);
  let title = "Untitled";
  let content = "";

  try {
    // Kiểm tra xem là Page hay Database
    try {
        const pageData = await notion.pages.retrieve({ page_id: id });
        const titleProp = Object.values(pageData.properties).find(p => p.type === 'title');
        title = titleProp?.title[0]?.plain_text || "Untitled";
        
        // Là Page thường -> Convert luôn
        const mdblocks = await n2m.pageToMarkdown(id);
        const mdString = n2m.toMarkdownString(mdblocks);
        content = mdString.parent;

    } catch (error) {
        if (error.code === 'validation_error') {
            // Là Database -> Gọi hàm xử lý riêng
            console.log("  -> Detected Database type.");
            const dbData = await notion.databases.retrieve({ database_id: id });
            title = dbData.title[0]?.plain_text || "Untitled_Database";
            content = await processDatabase(id, title);
        } else {
            throw error;
        }
    }
    
    const safeTitle = slugify(title, { replacement: '_', remove: /[*+~.()'"!:@]/g });
    const fileName = `${safeTitle}.md`;

    fs.writeFileSync(fileName, content);
    console.log(`✅ Saved to: ${fileName}`);
    
  } catch (error) {
    console.error(`❌ Failed ID ${id}:`, error.message);
  }
}

(async () => {
  console.log(`Found ${pageIds.length} items.`);
  for (const id of pageIds) {
    await backupPage(id);
  }
  console.log("\n🎉 Done.");
})();
