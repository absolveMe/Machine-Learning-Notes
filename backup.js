const { Client } = require("@notionhq/client");
const { NotionToMarkdown } = require("notion-to-md");
const fs = require("fs");
const axios = require("axios");
const path = require("path");

// --- CẤU HÌNH ---
const secret = process.env.NOTION_TOKEN;
const rawPageIds = process.env.NOTION_PAGE_ID;

if (!secret || !rawPageIds) {
  console.error("Error: Missing NOTION_TOKEN or NOTION_PAGE_ID.");
  process.exit(1);
}

const pageIds = rawPageIds.split(",").map(id => id.trim());
const notion = new Client({ auth: secret });
const n2m = new NotionToMarkdown({ notionClient: notion });

// --- HÀM LÀM SẠCH TÊN FILE ---
function sanitizeFilename(text) {
    if (!text) return "Untitled";
    return text.replace(/[^a-zA-Z0-9àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ\s-]/g, '_').trim();
}

// --- XỬ LÝ ẢNH ---
async function downloadImage(url, filename) {
  const dir = "images";
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  const filePath = path.join(dir, filename);
  const writer = fs.createWriteStream(filePath);
  
  try {
      const response = await axios({ url, method: 'GET', responseType: 'stream' });
      response.data.pipe(writer);
      return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });
  } catch (err) {
      writer.close();
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      throw err;
  }
}

n2m.setCustomTransformer('image', async (block) => {
  const { image } = block;
  const imageUrl = image.file?.url || image.external?.url;
  const caption = image.caption.length ? image.caption[0].plain_text : "image";
  const safeName = sanitizeFilename(caption) || "img";
  const uniqueName = `${safeName}_${block.id.slice(0, 5)}.png`;

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

// --- XỬ LÝ DATABASE (DÙNG AXIOS TRỰC TIẾP ĐỂ TRÁNH LỖI) ---
async function processDatabase(dbId, dbTitle) {
  console.log(`  -> 📂 Đang xử lý Database bằng Axios (Direct API)...`);
  
  // Dùng Axios gọi trực tiếp API Notion, bỏ qua thư viện bị lỗi
  const response = await axios.post(
    `https://api.notion.com/v1/databases/${dbId}/query`,
    { sorts: [{ property: 'Name', direction: 'ascending' }] },
    {
        headers: {
            'Authorization': `Bearer ${secret}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json'
        }
    }
  );

  const results = response.data.results;
  
  let fullContent = `# Database: ${dbTitle}\n\n`;
  fullContent += `## Mục lục (${results.length} bài)\n`;

  // Tạo mục lục
  for (const page of results) {
    const titleProp = Object.values(page.properties).find(p => p.type === 'title');
    const pageTitle = titleProp?.title[0]?.plain_text || "Untitled";
    const anchor = sanitizeFilename(pageTitle).toLowerCase();
    fullContent += `- [${pageTitle}](#${anchor})\n`;
  }

  fullContent += `\n---\n`;

  // Tải nội dung từng trang
  for (const page of results) {
    const titleProp = Object.values(page.properties).find(p => p.type === 'title');
    const pageTitle = titleProp?.title[0]?.plain_text || "Untitled";
    
    console.log(`    Processing: "${pageTitle}"`);
    
    // Convert trang con sang Markdown (hàm này vẫn chạy tốt)
    const mdblocks = await n2m.pageToMarkdown(page.id);
    const mdString = n2m.toMarkdownString(mdblocks);
    
    fullContent += `\n## <a name="${sanitizeFilename(pageTitle).toLowerCase()}"></a>${pageTitle}\n\n`;
    fullContent += mdString.parent + "\n\n---\n";
  }

  return fullContent;
}

// --- HÀM CHÍNH ---
async function backupPage(id) {
  console.log(`\n--- Đang xử lý ID: ${id} ---`);
  let title = "Untitled";
  let content = "";

  try {
    try {
        // Thử lấy page thường
        const pageData = await notion.pages.retrieve({ page_id: id });
        const titleProp = Object.values(pageData.properties).find(p => p.type === 'title');
        title = titleProp?.title[0]?.plain_text || "Untitled";
        
        const mdblocks = await n2m.pageToMarkdown(id);
        const mdString = n2m.toMarkdownString(mdblocks);
        content = mdString.parent;

    } catch (error) {
        // Nếu lỗi validation -> Chuyển sang xử lý Database
        if (error.code === 'validation_error' || (error.response && error.response.status === 400)) {
            // Lấy tên Database (Dùng axios luôn cho chắc)
            const dbData = await axios.get(
                `https://api.notion.com/v1/databases/${id}`,
                { headers: { 'Authorization': `Bearer ${secret}`, 'Notion-Version': '2022-06-28' } }
            );
            
            title = dbData.data.title[0]?.plain_text || "Untitled_Database";
            content = await processDatabase(id, title);
        } else {
            throw error;
        }
    }
    
    const fileName = `${sanitizeFilename(title)}.md`;
    fs.writeFileSync(fileName, content);
    console.log(`✅ Thành công!
