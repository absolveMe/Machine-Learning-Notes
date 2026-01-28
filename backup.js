const { Client } = require("@notionhq/client");
const { NotionToMarkdown } = require("notion-to-md");
const fs = require("fs");
const axios = require("axios");
const path = require("path");
const slugify = require("slugify");

// Config
const secret = process.env.NOTION_TOKEN;
const pageId = process.env.NOTION_PAGE_ID;

if (!secret || !pageId) {
  console.error("Error: Missing variables.");
  process.exit(1);
}

const notion = new Client({ auth: secret });
const n2m = new NotionToMarkdown({ notionClient: notion });

// --- 1. XỬ LÝ ẢNH (Tải về máy thay vì dùng link ảo) ---
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

n2m.setCustomTransformer('image', async (block) => {
  const { image } = block;
  const imageUrl = image.file?.url || image.external?.url;
  const caption = image.caption.length ? image.caption[0].plain_text : "image";
  
  // Đặt tên file ảnh gọn gàng
  const cleanCaption = slugify(caption, { lower: true, strict: true }) || "img";
  // Thêm ID ngắn để tránh trùng tên
  const uniqueName = `${cleanCaption}_${block.id.slice(0, 5)}.png`;

  try {
    console.log(`Downloading image: ${uniqueName}...`);
    await downloadImage(imageUrl, uniqueName);
    return `![${caption}](./images/${uniqueName})`; 
  } catch (error) {
    return `![${caption}](${imageUrl})`;
  }
});

// --- 2. XỬ LÝ TOÁN (Sửa lỗi không hiện trong gạch đầu dòng) ---
n2m.setCustomTransformer('equation', async (block) => {
  const { equation } = block;
  // Thêm dòng trắng (\n) để GitHub hiểu đây là khối toán học
  return `\n$$\n${equation.expression}\n$$\n`;
});

// --- CHẠY CHƯƠNG TRÌNH ---
(async () => {
  console.log(`Connecting to Page ID: ${pageId}...`);
  
  try {
    // Lấy tên Page
    const pageData = await notion.pages.retrieve({ page_id: pageId });
    const titleProp = Object.values(pageData.properties).find(p => p.type === 'title');
    const title = titleProp?.title[0]?.plain_text || "Untitled";
    const safeTitle = slugify(title, { replacement: '_', remove: /[*+~.()'"!:@]/g });
    const fileName = `${safeTitle}.md`;

    // Convert sang Markdown
    const mdblocks = await n2m.pageToMarkdown(pageId);
    const mdString = n2m.toMarkdownString(mdblocks);
    
    // Lưu file
    fs.writeFileSync(fileName, mdString.parent);
    console.log(`Success! Saved content to: ${fileName}`);
    
  } catch (error) {
    console.error("Backup Failed:", error);
    process.exit(1);
  }
})();
