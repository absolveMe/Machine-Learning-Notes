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

// --- HÀM HẬU KỲ: SỬA LỖI HIỂN THỊ (V7 - FIX MẠNH MẼ) ---
function fixFormatting(markdown) {
    let md = markdown;

    // 1. CỨU TIÊU ĐỀ (Headers):
    // Đảm bảo trước mỗi dấu # (Header) luôn có 2 dòng trắng để nó hiển thị đúng là Tiêu đề
    // (Tránh trường hợp bị dính vào dòng trên làm mất định dạng to)
    md = md.replace(/([^\n])\n(#{1,6} )/g, '$1\n\n$2');

    // 2. CỨU MATH ALIGN (Sửa lỗi image_5247f5):
    // Tìm những đoạn \begin{align...} mà chưa được bao bởi $$, và bao nó lại
    md = md.replace(/([^\$])(\\begin\{align\*?\})([\s\S]*?)(\\end\{align\*?\})/g, '$1\n$$\n$2$3$4\n$$\n');

    // 3. GỠ KHUNG CODE CHO MATH:
    // Nếu dòng bắt đầu bằng 4 khoảng trắng (hoặc tab) mà chứa $$, xóa khoảng trắng đi để nó thành Math thường
    md = md.replace(/^(\t|    )(\$\$)/gm, '$2');

    // 4. DỌN DẸP MATH BLOCK:
    // Xóa các dòng trắng thừa thãi bên trong $$...$$ để công thức gọn hơn
    md = md.replace(/\$\$\n\s*/g, '$$\n').replace(/\s*\n\$\$/g, '\n$$');

    return md;
}

// --- HÀM TRÍCH XUẤT PROPERTIES ---
function extractProperties(properties) {
    let content = "";
    for (const [key, value] of Object.entries(properties)) {
        if (value.type === "rich_text" && value.rich_text.length > 0) {
            const text = value.rich_text.map(t => t.plain_text).join("");
            content += `**${key}**: \n${text}\n\n`;
        } else if (value.type === "url" && value.url) {
            content += `**${key}**: ${value.url}\n\n`;
        }
    }
    return content;
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

// Transformer cho Equation: Trả về dạng thô, để hàm fixFormatting xử lý
n2m.setCustomTransformer('equation', async (block) => {
  return `\n$$\n${block.equation.expression}\n$$\n`;
});

// --- XỬ LÝ DATABASE ---
async function processDatabase(dbId, dbTitle) {
  console.log(`  -> 📂 Đang xử lý Database: ${dbTitle}`);
  
  try {
      const response = await axios.post(
        `https://api.notion.com/v1/databases/${dbId}/query`,
        { sorts: [{ property: 'Name', direction: 'ascending' }] },
        { headers: { 'Authorization': `Bearer ${secret}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' } }
      );

      const results = response.data.results;
      let fullContent = `# Database: ${dbTitle}\n\n`;
      fullContent += `## Mục lục (${results.length} bài)\n`;

      for (const page of results) {
        const titleProp = Object.values(page.properties).find(p => p.type === 'title');
        const pageTitle = titleProp?.title[0]?.plain_text || "Untitled";
        const anchor = sanitizeFilename(pageTitle).toLowerCase();
        fullContent += `- [${pageTitle}](#${anchor})\n`;
      }
      fullContent += `\n---\n`;

      for (const page of results) {
        const titleProp = Object.values(page.properties).find(p => p.type === 'title');
        const pageTitle = titleProp?.title[0]?.plain_text || "Untitled";
        
        console.log(`    Processing page: "${pageTitle}"`);
        
        const mdblocks = await n2m.pageToMarkdown(page.id);
        const mdString = n2m.toMarkdownString(mdblocks);
        let pageContent = mdString.parent;

        const propsContent = extractProperties(page.properties);
        if (propsContent) {
            pageContent = `### Properties Info:\n${propsContent}\n---\n${pageContent}`;
        }

        // ÁP DỤNG FIX LỖI FORMAT
        pageContent = fixFormatting(pageContent);
        
        fullContent += `\n## <a name="${sanitizeFilename(pageTitle).toLowerCase()}"></a>${pageTitle}\n\n`;
        fullContent += pageContent + "\n\n---\n";
      }

      return fullContent;
  } catch (error) {
      console.error("  ❌ Lỗi Database:", error.message);
      return `# Lỗi khi tải Database ${dbTitle}\nCannot load content.`;
  }
}

// --- HÀM CHÍNH ---
async function backupPage(id) {
  console.log(`\n--- Đang xử lý ID: ${id} ---`);
  let title = "Untitled";
  let content = "";

  try {
    try {
        const pageData = await notion.pages.retrieve({ page_id: id });
        const titleProp = Object.values(pageData.properties).find(p => p.type === 'title');
        title = titleProp?.title[0]?.plain_text || "Untitled";
        
        const mdblocks = await n2m.pageToMarkdown(id);
        const mdString = n2m.toMarkdownString(mdblocks);
        
        // Fix lỗi cho page thường
        content = fixFormatting(mdString.parent);

    } catch (error) {
        if (error.code === 'validation_error' || (error.response && error.response.status === 400)) {
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
    console.log(`✅ Thành công! Đã lưu: ${fileName}`);
    
  } catch (error) {
    console.error(`❌ Lỗi nghiêm trọng tại ID ${id}:`, error.message);
  }
}

(async () => {
  console.log(`Tìm thấy ${pageIds.length} mục cần backup.`);
  for (const id of pageIds) {
    await backupPage(id);
  }
  console.log("\n🎉 Hoàn tất toàn bộ.");
})();
