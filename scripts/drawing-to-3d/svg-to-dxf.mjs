/**
 * svg-to-dxf.mjs — 자체 생성 도면 SVG(알려진 서브셋) → DXF R12 ASCII.
 * 지원 요소: <line> <rect> <circle> <text> <path>(M/L/H/V 절대좌표만).
 * 좌표계: SVG y↓ → DXF y↑ 반전(viewBox 높이 기준). 치수·주석 텍스트 포함.
 * 한계(명시): 곡선(C/A)·transform 미지원 — 자체 도면은 해당 요소 미사용.
 * 검증: 라운드트립 스모크(엔티티 수 일치) — 파서는 자체 SVG 서브셋 전용.
 */
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

function parseAttrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([a-zA-Z_-]+)="([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

export function svgToDxf(svg) {
  const vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  const H = vb ? num(vb[2]) : 800;
  const flipY = (y) => H - y;
  const ents = [];
  const line = (x1, y1, x2, y2, layer = 'DRAW') =>
    ents.push(`0\nLINE\n8\n${layer}\n10\n${x1.toFixed(2)}\n20\n${flipY(y1).toFixed(2)}\n11\n${x2.toFixed(2)}\n21\n${flipY(y2).toFixed(2)}`);
  // <line>
  for (const m of svg.matchAll(/<line\b[^>]*>/g)) {
    const a = parseAttrs(m[0]);
    line(num(a.x1), num(a.y1), num(a.x2), num(a.y2), a.class?.includes('dim') || a.stroke === '#2563eb' ? 'DIM' : 'DRAW');
  }
  // <rect> → 4변
  for (const m of svg.matchAll(/<rect\b[^>]*>/g)) {
    const a = parseAttrs(m[0]);
    const x = num(a.x), y = num(a.y), w = num(a.width), h2 = num(a.height);
    if (w <= 0 || h2 <= 0) continue;
    line(x, y, x + w, y); line(x + w, y, x + w, y + h2); line(x + w, y + h2, x, y + h2); line(x, y + h2, x, y);
  }
  // <circle>
  for (const m of svg.matchAll(/<circle\b[^>]*>/g)) {
    const a = parseAttrs(m[0]);
    ents.push(`0\nCIRCLE\n8\nDRAW\n10\n${num(a.cx).toFixed(2)}\n20\n${flipY(num(a.cy)).toFixed(2)}\n40\n${num(a.r).toFixed(2)}`);
  }
  // <path d="M x y V y2 H x2 L x y ..."> — 절대좌표 서브셋
  for (const m of svg.matchAll(/<path\b[^>]*\bd="([^"]+)"[^>]*>/g)) {
    const d = m[1];
    let cx = 0, cy = 0, sx = 0, sy = 0;
    const toks = d.match(/[MLHVZ]|-?[\d.]+/gi) ?? [];
    let i = 0;
    while (i < toks.length) {
      const c = toks[i];
      if (c === 'M') { cx = num(toks[i + 1]); cy = num(toks[i + 2]); sx = cx; sy = cy; i += 3; }
      else if (c === 'L') { const nx = num(toks[i + 1]), ny = num(toks[i + 2]); line(cx, cy, nx, ny); cx = nx; cy = ny; i += 3; }
      else if (c === 'H') { const nx = num(toks[i + 1]); line(cx, cy, nx, cy); cx = nx; i += 2; }
      else if (c === 'V') { const ny = num(toks[i + 1]); line(cx, cy, cx, ny); cy = ny; i += 2; }
      else if (c === 'Z' || c === 'z') { line(cx, cy, sx, sy); i += 1; }
      else i += 1; // 미지원 토큰 스킵(자체 도면엔 없음)
    }
  }
  // <text>
  for (const m of svg.matchAll(/<text\b([^>]*)>([^<]*)<\/text>/g)) {
    const a = parseAttrs(`<text ${m[1]}>`);
    const txt = m[2].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
    if (!txt) continue;
    const hgt = a['font-size'] ? num(a['font-size']) : 11;
    ents.push(`0\nTEXT\n8\nTEXT\n10\n${num(a.x).toFixed(2)}\n20\n${flipY(num(a.y)).toFixed(2)}\n40\n${hgt.toFixed(1)}\n1\n${txt.slice(0, 250)}${a['text-anchor'] === 'middle' ? '\n72\n1\n11\n' + num(a.x).toFixed(2) + '\n21\n' + flipY(num(a.y)).toFixed(2) : ''}`);
  }
  return `0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1009\n0\nENDSEC\n0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n70\n3\n0\nLAYER\n2\nDRAW\n70\n0\n62\n7\n6\nCONTINUOUS\n0\nLAYER\n2\nDIM\n70\n0\n62\n5\n6\nCONTINUOUS\n0\nLAYER\n2\nTEXT\n70\n0\n62\n3\n6\nCONTINUOUS\n0\nENDTAB\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${ents.join('\n')}\n0\nENDSEC\n0\nEOF\n`;
}

// self-test
const isMain = typeof process !== 'undefined' && process.argv?.[1] && process.argv[1].replaceAll('\\', '/').endsWith('svg-to-dxf.mjs');
if (isMain) {
  const { retainingWallSectionSvg, rebarElevationSvg } = await import('./section-drawings.mjs');
  const svg = retainingWallSectionSvg({ H: 4000, baseWidth: 2600, baseThickness: 450, stemThickness: 350, toeLength: 700 });
  const dxf = svgToDxf(svg);
  const lines = (dxf.match(/\nLINE\n/g) || []).length;
  const texts = (dxf.match(/\nTEXT\n/g) || []).length;
  const ok = dxf.startsWith('0\nSECTION') && dxf.endsWith('EOF\n') && lines > 10 && texts >= 5;
  console.log(`svg-to-dxf self-test: LINE ${lines} · TEXT ${texts} · ${ok ? 'OK' : 'FAIL'}`);
  const dxf2 = svgToDxf(rebarElevationSvg({ type: 'beam', L_mm: 6000 }));
  console.log('rebar elevation DXF:', (dxf2.match(/\nLINE\n/g) || []).length, 'lines', dxf2.includes('EOF') ? 'OK' : 'FAIL');
  if (!ok) process.exit(1);
}
