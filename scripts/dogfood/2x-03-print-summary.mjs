// 2x-03: 쉬운요약.html 을 사람이 읽는 텍스트로 그대로 출력(verbatim 본문)
import { readFileSync } from 'node:fs';
const file = process.argv[2];
let h = readFileSync(file, 'utf8');
h = h.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
h = h.replace(/<\/(p|li|h1|h2|div|tr|section|ol|ul|table)>/g, '\n')
  .replace(/<\/td>|<\/th>/g, ' | ')
  .replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
console.log(h.trim());
