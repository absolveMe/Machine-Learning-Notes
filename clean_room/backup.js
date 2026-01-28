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

// Tách ID và khởi tạo Client
const pageIds = rawPageIds.split(",").map(id => id.trim());
const notion = new Client({ auth: secret });
const n2m = new NotionToMarkdown({ notionClient: notion });

// --- HÀM TIỆN ÍCH: LÀM SẠCH TÊN FILE ---
// Hàm này sẽ thay thế TẤT CẢ ký tự đặc biệt bằng dấu gạch dưới (_)
// Lab 28/1 -> Lab_28_1
// Project: A -> Project__A
function sanitizeFilename(text) {
    if (!text) return "Untitled";
    // Chỉ giữ lại chữ cái, số, và tiếng Việt có dấu. Còn lại thay bằng _
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
      fs.unlinkSync(filePath); // Xóa file lỗi
      throw err;
  }
}

n2m.setCustomTransformer('image', async (block) => {
  const { image } = block;
  const imageUrl = image.file?.url || image.external?.url;
  const caption = image.caption.length ? image.caption[0].plain_text : "image";
  
  // Tạo tên ảnh an toàn
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

// --- XỬ LÝ DATABASE ---
async function processDatabase(dbId, dbTitle) {
  console.log(`  -> 📂 Đang xử lý Database...`);
  
  // Query lấy danh sách bài viết
  const response = await notion.databases.query({
    database_id: dbId,
    sorts: [{ property: 'Name', direction: 'ascending' }]
  });

  let fullContent = `# Database: ${dbTitle}\n\n`;
  fullContent += `## Mục lục (${response.results.length} trang)\n`;

  // Tạo mục lục
  for (const page of response.results) {
    const titleProp = Object.values(page.properties).find(p => p.type === 'title');
    const pageTitle = titleProp?.title[0]?.plain_text || "Untitled";
    // Tạo link nhảy nội bộ
    const anchor = sanitizeFilename(pageTitle).toLowerCase();
    fullContent += `- [${pageTitle}](#${anchor})\n`;
  }

  fullContent += `\n---\n`;

  // Tải nội dung từng trang
  for (const page of response.results) {
    const titleProp = Object.values(page.properties).find(p => p.type === 'title');
    const pageTitle = titleProp?.title[0]?.plain_text || "Untitled";
    
    console.log(`    Processing: "${pageTitle}"`);
    
    const mdblocks = await n2m.pageToMarkdown(page.id);
    const mdString = n2m.toMarkdownString(mdblocks);
    
    // Thêm header để tạo anchor link
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
    // Thử lấy thông tin Page
    try {
        const pageData = await notion.pages.retrieve({ page_id: id });
        const titleProp = Object.values(pageData.properties).find(p => p.type === 'title');
        title = titleProp?.title[0]?.plain_text || "Untitled";
        
        // Là Page -> Convert luôn
        const mdblocks = await n2m.pageToMarkdown(id);
        const mdString = n2m.toMarkdownString(mdblocks);
        content = mdString.parent;

    } catch (error) {
        // Nếu lỗi là Validation Error -> Nó là Database
        if (error.code === 'validation_error') {
            const dbData = await notion.databases.retrieve({ database_id: id });
            title = dbData.title[0]?.plain_text || "Untitled_Database";
            content = await processDatabase(id, title);
        } else {
            throw error;
        }
    }
    
    // Đặt tên file (Đã được làm sạch ký tự đặc biệt)
    const fileName = `${sanitizeFilename(title)}.md`;

    fs.writeFileSync(fileName, content);
    console.log(`✅ Thành công! Đã lưu: ${fileName}`);
    
  } catch (error) {
    console.error(`❌ Lỗi tại ID ${id}:`, error.message);
  }
}

// Chạy vòng lặp
(async () => {
  console.log(`Tìm thấy ${pageIds.length} mục cần backup.`);
  for (const id of pageIds) {
    await backupPage(id);
  }
  console.log("\n🎉 Hoàn tất toàn bộ.");
})();
