// NexyFab 공개 페이지 개편 전 HTML 백업 (라이브 렌더 스냅샷)
// usage: node snapshot-nexyfab.mjs
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = dirname(fileURLToPath(import.meta.url));
const BASE = 'https://nexyfab.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// 공개 마케팅/진입 페이지만 (로그인 영역 제외)
const PAGES = [
  ['landing-kr',        '/kr/'],
  ['landing-en',        '/en/'],
  ['how-it-works-kr',   '/kr/how-it-works'],
  ['pricing-kr',        '/kr/nexyfab/pricing'],
  ['download-kr',       '/kr/download'],
  ['contact-kr',        '/kr/contact'],
  ['help-kr',           '/kr/help'],
  ['trust-kr',          '/kr/trust'],
  ['api-docs-kr',       '/kr/api-docs'],
  ['shape-generator-kr','/kr/shape-generator'],
  ['simulator-kr',      '/kr/simulator'],
];

await mkdir(OUT, { recursive: true });
const results = [];
for (const [name, path] of PAGES) {
  try {
    const res = await fetch(BASE + path, {
      headers: { 'user-agent': UA, accept: 'text/html', 'accept-language': 'ko,en;q=0.8' },
      redirect: 'follow',
    });
    const html = await res.text();
    if (res.status === 200) await writeFile(join(OUT, `${name}.html`), html, 'utf8');
    results.push({ name, path, status: res.status, bytes: html.length, finalUrl: res.url });
  } catch (e) {
    results.push({ name, path, error: String(e) });
  }
  await new Promise(r => setTimeout(r, 1500));
}
await writeFile(join(OUT, 'snapshot-meta.json'), JSON.stringify({
  snapshotDate: new Date().toISOString(),
  base: BASE,
  purpose: '랜딩 개편 전 NexyFab 공개 페이지 백업 (before 기록)',
  results,
}, null, 2), 'utf8');
console.table(results.map(r => ({ name: r.name, status: r.status ?? 'ERR', KB: r.bytes ? Math.round(r.bytes / 1024) : '-' })));
