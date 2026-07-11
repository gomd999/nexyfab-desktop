// 백업 HTML을 브라우저에서 바로 열리는 자립형(viewable)으로 변환
// - <link rel="stylesheet"> → CSS 본문 fetch 후 <style> 인라인 (개편 배포 후 해시 CSS 소멸 대비)
// - src/href/srcset 상대경로 → https://nexyfab.com 절대경로
// - <script> 제거 (하이드레이션 오류 방지 — 정적 렌더 열람 목적)
// usage: node make-viewable.mjs
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const OUT = join(DIR, 'viewable');
const BASE = 'https://nexyfab.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const cssCache = new Map();
async function fetchCss(url) {
  if (cssCache.has(url)) return cssCache.get(url);
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    let css = await res.text();
    // CSS 내부 url(/...) 상대경로도 절대화
    css = css.replace(/url\(\s*(['"]?)\/(?!\/)/g, `url($1${BASE}/`);
    cssCache.set(url, css);
    return css;
  } catch (e) {
    console.warn(`  css fail ${url}: ${e.message}`);
    cssCache.set(url, null);
    return null;
  }
}

function absolutize(html) {
  // src="/x", href="/x" (단 href="//" 프로토콜 상대 제외) → 절대경로
  html = html.replace(/(\s(?:src|href|poster|content))=(["'])\/(?!\/)/g, `$1=$2${BASE}/`);
  // srcset 내 각 후보 경로
  html = html.replace(/(\ssrcset=)(["'])([^"']+)\2/g, (m, p, q, v) =>
    `${p}${q}${v.replace(/(^|,\s*)\/(?!\/)/g, `$1${BASE}/`)}${q}`);
  return html;
}

await mkdir(OUT, { recursive: true });
const files = (await readdir(DIR)).filter(f => f.endsWith('.html'));
for (const f of files) {
  let html = await readFile(join(DIR, f), 'utf8');

  // 1) 스타일시트 인라인
  const links = [...html.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi)];
  for (const [tag] of links) {
    const href = tag.match(/href=["']([^"']+)["']/)?.[1];
    if (!href) continue;
    const url = href.startsWith('http') ? href : BASE + (href.startsWith('/') ? href : '/' + href);
    const css = await fetchCss(url);
    if (css != null) html = html.replace(tag, `<style data-inlined="${href}">\n${css}\n</style>`);
  }

  // 2) 스크립트 제거 (정적 열람용)
  html = html.replace(/<script\b[\s\S]*?<\/script>/gi, '');
  // preload/modulepreload 링크 제거 (죽은 참조 소음 방지)
  html = html.replace(/<link\b[^>]*rel=["'](?:preload|modulepreload|prefetch)["'][^>]*>/gi, '');

  // 3) 잔여 상대경로 절대화 (이미지/폰트 등)
  html = absolutize(html);

  // 4) JS 제거로 안 뜨는 scroll-reveal 요소 강제 표시 (.reveal은 JS가 .active를 붙여야 보임)
  const override = `<style data-static-view-override>
.reveal,[class*="reveal"]{opacity:1 !important;transform:none !important;visibility:visible !important;}
</style>`;
  html = html.includes('</body>') ? html.replace('</body>', `${override}</body>`) : html + override;

  html = `<!-- NexyFab 개편 전 백업 열람본 (2026-07-11) — CSS 인라인, JS 제거, 자산 절대경로, reveal 강제표시 -->\n` + html;
  await writeFile(join(OUT, f), html, 'utf8');
  console.log(`${f} -> viewable/ (${Math.round(html.length / 1024)}KB)`);
}
console.log(`done: ${files.length} files, ${cssCache.size} stylesheets fetched`);
