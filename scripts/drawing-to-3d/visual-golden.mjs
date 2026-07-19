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
import { renderColoredHtml } from './html-render.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(HERE, 'golden');
const TMP = join(HERE, 'out', 'golden-tmp');
const UPDATE = process.argv.includes('--update');
const DIFF_RATIO_MAX = 0.005; // 0.5%
const CH_TOL = 16;            // 채널당 허용 차(안티앨리어싱 여유)

/** RC보(철근 어휘 R2-④): 콘크리트 보 + 주철근 4본 + 스터럽 5개소 — 결정론 픽스처. */
function rcBeamAssembly() {
  const L = 4000, b = 300, h = 500, c = 40;
  const parts = [
    { id: 'beam_conc', type: 'box', params: { width: L, depth: b, height: h }, at: { tx: 0, ty: 0, tz: 0 }, material: 'concrete', role: 'beam' },
  ];
  let n = 0;
  for (const z of [c, h - c]) for (const y of [c, b - c]) {
    parts.push({ id: `main_${++n}`, type: 'rebar', params: { dia: z === c ? 22 : 16, points: [[c, y, z], [L - c, y, z]] }, at: { tx: 0, ty: 0, tz: 0 }, material: 'steel' });
  }
  for (let i = 0; i < 5; i++) {
    const x = 200 + i * 900;
    parts.push({ id: `stir_${i + 1}`, type: 'rebar', params: { dia: 10, points: [[x, c, c], [x, b - c, c], [x, b - c, h - c], [x, c, h - c], [x, c, c]] }, at: { tx: 0, ty: 0, tz: 0 }, material: 'steel' });
  }
  return { name: 'rc_beam', parts };
}

/** SWRO 스키드(플랜트 대표): 베이스+고압펌프+베셀 랙 2단+계통 배관 — 결정론 픽스처. */
function swroSkidAssembly() {
  return {
    name: 'swro_skid',
    parts: [
      { id: 'skid_base', type: 'box', params: { width: 3600, depth: 1200, height: 100 }, at: { tx: 0, ty: 0, tz: 0 }, material: 'steel', role: 'base' },
      { id: 'hp_pump', type: 'box', params: { width: 600, depth: 400, height: 400 }, at: { tx: 100, ty: 400, tz: 100 }, material: 'steel', role: 'motor' },
      { id: 'rack_a', type: 'box', params: { width: 100, depth: 100, height: 700 }, at: { tx: 900, ty: 550, tz: 100 }, material: 'steel', role: 'column' },
      { id: 'rack_b', type: 'box', params: { width: 100, depth: 100, height: 700 }, at: { tx: 3300, ty: 550, tz: 100 }, material: 'steel', role: 'column' },
      { id: 'vessel_1', type: 'tube', params: { outerDia: 200, innerDia: 180, length: 2400 }, at: { tx: 900, ty: 600, tz: 500, ry: 90 }, material: 'steel', role: 'vessel' },
      { id: 'vessel_2', type: 'tube', params: { outerDia: 200, innerDia: 180, length: 2400 }, at: { tx: 900, ty: 600, tz: 800, ry: 90 }, material: 'steel', role: 'vessel' },
    ],
    pipes: [
      { id: 'feed_hp', from: 'hp_pump.x+', to: 'vessel_1.x-', d: 34, service: 'hp' },
      { id: 'stage12', from: 'vessel_1.x+', to: 'vessel_2.x+', d: 27, service: 'concentrate' },
      { id: 'permeate', from: 'vessel_2.x-', to: [3500, 100, 300], d: 27, service: 'permeate' },
    ],
  };
}

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
    // E2 확대(260719): 플랜트·기계·철근 GA_2D
    ['mech-tema-hx', buildAssemblyTemplate('mech', 'heat_exchanger', {}), 'mech'],
    ['mech-flanged-elbow', buildAssemblyTemplate('mech', 'flanged_fitting', {}), 'mech'],
    ['rc-beam-rebar', rcBeamAssembly(), 'building'],
    ['swro-skid', swroSkidAssembly(), 'mech'],
  ];
}

// E2 확대(260719): GA_3D 캔버스 실렌더 골든 — swiftshader 소프트웨어 래스터 고정 전제
function cases3d() {
  return [
    ['ga3d-tema-hx', buildAssemblyTemplate('mech', 'heat_exchanger', {})],
    ['ga3d-swro-skid', swroSkidAssembly()],
    ['ga3d-rc-beam', rcBeamAssembly()],
  ];
}

/** 골든 대조(공용): true=PASS. update/최초는 골든 저장. */
async function compareShot(name, shot, { diffMax = DIFF_RATIO_MAX } = {}) {
  const gPath = join(GOLDEN, name + '.png');
  if (UPDATE || !existsSync(gPath)) {
    writeFileSync(gPath, shot);
    console.log(`UPDATED ${name}`);
    return true;
  }
  const [a, b] = await Promise.all([
    sharp(shot).raw().toBuffer({ resolveWithObject: true }),
    sharp(readFileSync(gPath)).raw().toBuffer({ resolveWithObject: true }),
  ]);
  if (a.info.width !== b.info.width || a.info.height !== b.info.height) {
    console.log(`FAIL ${name}: 크기 ${a.info.width}×${a.info.height} vs 골든 ${b.info.width}×${b.info.height}`);
    writeFileSync(join(TMP, name + '.actual.png'), shot);
    return false;
  }
  let bad = 0;
  const n = a.info.width * a.info.height;
  for (let i = 0; i < a.data.length; i += a.info.channels) {
    if (Math.abs(a.data[i] - b.data[i]) > CH_TOL || Math.abs(a.data[i + 1] - b.data[i + 1]) > CH_TOL || Math.abs(a.data[i + 2] - b.data[i + 2]) > CH_TOL) bad++;
  }
  const ratio = bad / n;
  if (ratio <= diffMax) { console.log(`OK ${name} (diff ${(ratio * 100).toFixed(3)}%)`); return true; }
  console.log(`FAIL ${name}: diff ${(ratio * 100).toFixed(3)}% > ${diffMax * 100}% — ${name}.actual.png 저장`);
  writeFileSync(join(TMP, name + '.actual.png'), shot);
  return false;
}

async function main() {
  mkdirSync(GOLDEN, { recursive: true });
  mkdirSync(TMP, { recursive: true });
  // swiftshader 고정(E2): GA_3D 캔버스 WebGL 을 소프트웨어 래스터로 결정론화(GPU 무관)
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
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
    (await compareShot(name, shot)) ? pass++ : fail++;
  }
  // GA_3D(E2 260719): openscad 실렌더 STL → three.js 캔버스 — 정적 카메라 첫 프레임 대조.
  // 밴드 2%(2D 0.5% 대비 완화 명시 — 소프트 래스터라도 AA 미세차 여유)
  for (const [name, asm] of cases3d()) {
    try {
      const html = await renderColoredHtml({ assembly: asm }, { title: name, subtitle: 'visual-golden GA_3D(비법정)' });
      const htmlPath = join(TMP, name + '.html');
      writeFileSync(htmlPath, html);
      await page.goto(pathToFileURL(htmlPath).href);
      await page.waitForSelector('canvas');
      await page.waitForTimeout(800); // 첫 프레임 안정화(정적 카메라·autoRotate off)
      const shot = await page.screenshot({ fullPage: false });
      (await compareShot(name, shot, { diffMax: 0.02 })) ? pass++ : fail++;
    } catch (e) {
      console.log(`FAIL ${name}: ${String(e?.message ?? e).slice(0, 120)}`);
      fail++;
    }
  }
  await browser.close();
  console.log(`visual-golden: ${pass}/${pass + fail}${UPDATE ? ' (update mode)' : ''}`);
  if (fail) process.exit(1);
}
main();
