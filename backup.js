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

// --- HÀM HẬU KỲ: SỬA LỖI HIỂN THỊ (V8 - FIX TOÁN HỌC) ---
function fixFormatting(markdown) {
    let md = markdown;

    // 1. NÂNG CẤP TOÁN ĐỨNG RIÊNG (Standalone Inline Math -> Block Math)
    // Nếu một dòng chỉ chứa công thức toán nằm giữa 2 dấu $ (ví dụ: $ f(x) = y $),
    // hãy đổi nó thành $$...$$ để hiển thị to và đẹp.
    // Regex tìm: Đầu dòng + dấu $ + nội dung + dấu $ + cuối dòng
    md = md.replace(/^\s*\$ (.+) \$\s*$/gm, '\n$$\n$1\n$$\n');
    md = md.replace(/^\s*\$(.+)\$\s*$/gm, '\n$$\n$1\n$$\n');

    // 2. SỬA LỖI KHOẢNG TRẮNG TRONG TOÁN INLINE
    // GitHub không thích dấu cách ngay sau dấu $ (ví dụ: $ x $ -> lỗi, $x$ -> ok)
    // Lệnh này xóa khoảng trắng thừa ở 2 đầu: $ x $ -> $x$
    md = md.replace(/([^\$])\$ ([^\$\n]+?) \$([^\$])/g, '$1$$$2$$$3');

    // 3. CỨU TIÊU ĐỀ (Headers):
    // Đảm bảo trước mỗi dấu # (Header) luôn có 2
