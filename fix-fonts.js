const fs = require('fs');
const content = fs.readFileSync('src/app/custom.css', 'utf8');
const newContent = content.replace(/font-family:\s*Pretendard[^{;}]*;/gs, 'font-family: Pretendard, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Noto Sans SC", "Microsoft YaHei", "Noto Sans KR", Arial, sans-serif;');
fs.writeFileSync('src/app/custom.css', newContent, 'utf8');
console.log("Replacements across multiline complete");
