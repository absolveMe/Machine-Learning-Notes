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

// Tách chuỗi ID thành danh sách (mảng) dựa trên dấu phẩy
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
    // console.log(`Downloading image: ${uniqueName}...`); // Bỏ comment nếu muốn xem log chi tiết
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

// --- 2. HÀM XỬ LÝ TỪNG PAGE ---
async function backupPage(pageId) {
  console.log(`\n--- Processing Page ID: ${pageId} ---`);
  try {
    // Lấy tên Page
    const pageData = await notion.pages.retrieve({ page_id: pageId });
    const titleProp = Object.values(pageData.properties).find(p => p.type === 'title');
    const title = titleProp?.title[0]?.plain_text || "Untitled";
    
    // Tạo tên file an toàn
    const safeTitle = slugify(title, { replacement: '_', remove: /[*+~.()'"!:@]/g });
    const fileName = `${safeTitle}.md`;

    console.log(`Found Page: "${title}" -> Saving to: ${fileName}`);

    // Convert sang Markdown
    const mdblocks = await n2m.pageToMarkdown(pageId);
    const mdString = n2m.toMarkdownString(mdblocks);
    
    // Lưu file
    fs.writeFileSync(fileName, mdString.parent);
    console.log(`✅ Success!`);
    
  } catch (error) {
    console.error(`❌ Failed to backup page ${pageId}:`, error.body || error.message);
    // Không dùng process.exit(1) ở đây để nếu 1 page lỗi, các page khác vẫn chạy tiếp
  }
}

// --- CHẠY VÒNG LẶP ---
(async () => {
  console.log(`Found ${pageIds.length} pages to backup.`);
  
  // Dùng vòng lặp for...of để chạy tuần tự từng page
  for (const id of pageIds) {
    await backupPage(id);
  }
  
  console.log("\n🎉 All operations completed.");
})();
