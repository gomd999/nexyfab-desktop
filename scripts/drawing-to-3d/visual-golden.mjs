/**
 * visual-golden.mjs — 도면 시각 회귀(골든 스크린샷) (linear-drawing-plan §0.4).
 * 지금까지는 문자열 검사뿐이라 도면이 "시각적으로" 깨져도 못 잡았다. 대표 도면 6종을
 * Playwright 로 캡처해 golden/ PNG 와 픽셀 대조(채널차 >16 픽셀 비율 ≤ 0.5%).
 *
 * usage: node scripts/drawing-to-3d/visual-golden.mjs [--update]
 *  - --update: 골든 재생성(의도된 시각 변경 시에만 — 커밋 리뷰로 확인)
 * 함정: file:// 는 pathToFileURL(공백·한글 경로) · repo 루트에서 실행(node_modules 해석).
 * 동일 머신 골든 전제(폰트 렌더링 환경 차이는 CI 이식 시 재생성).
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { buildAssemblyTemplate } from './domain-assemblies.mjs';
import { buildAssembly } from './assembly.mjs';
import { ga2dDrawing } from './package.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(HERE, 'golden');
const TMP = join(HERE, 'out', 'golden-tmp');
const UPDATE = process.argv.includes('--update');
const DIFF_RATIO_MAX = 0.005; // 0.5%
const CH_TOL = 16;            // 채널당 허용 차(안티앨리어싱 여유)

function cases() {
  const deckSite = buildAssemblyTemplate('landscape', 'timber_deck', {});
  deckSite.siteBoundary = [[-2000, -2000], [16000, -2000], [16000, 10000], [-2000, 10000]];
  deckSite.contours = [{ elevM: 10, pts: [[-2000, 0], [16000, 2000]] }];
  return [
    ['civil-run-500m', buildAssemblyTemplate('civil', 'retaining_wall_run', { length: 500000 }), 'civil'],
    ['civil-align-L', buildAssemblyTemplate('civil', 'retaining_wall_alignment', {}), 'civil'],
    ['civil-align-1300m', buildAssemblyTemplate('civil', 'retaining_wall_alignment', { ips: [[0, 0], [500000, 0], [900000, 300000], [1200000, 300000]] }), 'civil'],
    ['building-rc3', buildAssemblyTemplate('building', 'rc_frame', { floors: 3, baysX: 3, baysY: 2 }), 'building'],
    ['interior-studio', buildAssemblyTemplate('interior', 'studio_unit', {}), 'interior'],
    ['landscape-deck-site', deckSite, 'landscape'],
    ['bridge-girder-30m', buildAssemblyTemplate('bridge', 'girder_bridge', {}), 'bridge'],
  ];
}

async function main() {
  mkdirSync(GOLDEN, { recursive: true });
  mkdirSync(TMP, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1240, height: 900 }, deviceScaleFactor: 1 });
  let pass = 0, fail = 0;
  for (const [name, asm, domain] of cases()) {
    const built = buildAssembly(asm);
    const html = ga2dDrawing(asm, { title: name, domain, pipes: built.pipes?.routes });
    const htmlPath = join(TMP, name + '.html');
    writeFileSync(htmlPath, html);
    await page.goto(pathToFileURL(htmlPath).href);
    await page.waitForTimeout(120);
    const shot = await page.screenshot({ fullPage: true });
    const gPath = join(GOLDEN, name + '.png');
    if (UPDATE || !existsSync(gPath)) {
      writeFileSync(gPath, shot);
      console.log(`UPDATED ${name}`);
      pass++;
      continue;
    }
    const [a, b] = await Promise.all([
      sharp(shot).raw().toBuffer({ resolveWithObject: true }),
      sharp(readFileSync(gPath)).raw().toBuffer({ resolveWithObject: true }),
    ]);
    if (a.info.width !== b.info.width || a.info.height !== b.info.height) {
      console.log(`FAIL ${name}: 크기 ${a.info.width}×${a.info.height} vs 골든 ${b.info.width}×${b.info.height}`);
      writeFileSync(join(TMP, name + '.actual.png'), shot);
      fail++;
      continue;
    }
    let bad = 0;
    const n = a.info.width * a.info.height;
    for (let i = 0; i < a.data.length; i += a.info.channels) {
      if (Math.abs(a.data[i] - b.data[i]) > CH_TOL || Math.abs(a.data[i + 1] - b.data[i + 1]) > CH_TOL || Math.abs(a.data[i + 2] - b.data[i + 2]) > CH_TOL) bad++;
    }
    const ratio = bad / n;
    if (ratio <= DIFF_RATIO_MAX) { console.log(`OK ${name} (diff ${(ratio * 100).toFixed(3)}%)`); pass++; }
    else { console.log(`FAIL ${name}: diff ${(ratio * 100).toFixed(3)}% > ${DIFF_RATIO_MAX * 100}% — ${name}.actual.png 저장`); writeFileSync(join(TMP, name + '.actual.png'), shot); fail++; }
  }
  await browser.close();
  console.log(`visual-golden: ${pass}/${pass + fail}${UPDATE ? ' (update mode)' : ''}`);
  if (fail) process.exit(1);
}
main();
