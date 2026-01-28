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

// --- CẤU HÌNH XỬ LÝ ẢNH ---
// Hàm tải ảnh từ URL về máy
async function downloadImage(url, filename) {
  const dir = "images"; // Thư mục chứa ảnh
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
  }

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

// Tùy chỉnh cách Notion chuyển đổi ẢNH sang Markdown
n2m.setCustomTransformer('image', async (block) => {
  const { image } = block;
  const imageUrl = image.file?.url || image.external?.url;
  const caption = image.caption.length ? image.caption[0].plain_text : "image";
  
  // Tạo tên file ảnh an toàn
  const cleanCaption = slugify(caption, { lower: true, strict: true }) || "img";
  const uniqueName = `${cleanCaption}_${block.id.slice(0, 8)}.png`;

  try {
    console.log(`Downloading image: ${uniqueName}...`);
    await downloadImage(imageUrl, uniqueName);
    // Trả về cú pháp Markdown trỏ vào file ảnh đã tải
    return `![${caption}](./images/${uniqueName})`; 
  } catch (error) {
    console.error("Failed to download image:", error.message);
    return `![${caption}](${imageUrl})`; // Nếu lỗi thì dùng link cũ
  }
});

// --- CẤU HÌNH XỬ LÝ TOÁN (MATH) ---
// Tùy chỉnh cách Notion chuyển đổi công thức TOÁN sang Markdown
n2m.setCustomTransformer('equation', async (block) => {
  const { equation } = block;
  // Bao quanh bằng $$ để GitHub hiểu là toán
  return `$$
${equation.expression}
$$`;
});

// --- CHẠY CHƯƠNG TRÌNH ---
(async () => {
  console.log(`Connecting to Page ID: ${pageId}...`);
  
  try {
    // 1. Lấy tên Page
    const pageData = await notion.pages.retrieve({ page_id: pageId });
    const titleProp = Object.values(pageData.properties).find(p => p.type === 'title');
    const title = titleProp?.title[0]?.plain_text || "Untitled";
    const safeTitle = slugify(title, { replacement: '_', remove: /[*+~.()'"!:@]/g });
    const fileName = `${safeTitle}.md`;

    // 2. Chuyển đổi sang Markdown (Code ở trên sẽ tự động tải ảnh trong lúc này)
    const mdblocks = await n2m.pageToMarkdown(pageId);
    const mdString = n2m.toMarkdownString(mdblocks);
    
    // 3. Lưu file
    fs.writeFileSync(fileName, mdString.parent);
    console.log(`Success! Saved content to: ${fileName}`);
    console.log(`Images saved to /images folder.`);
    
  } catch (error) {
    console.error("Backup Failed:", error);
    process.exit(1);
  }
})();
