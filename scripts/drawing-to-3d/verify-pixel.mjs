/**
 * 2D→3D ④ — 픽셀 검증 루프 (drawing-diff): 추출 intent를 동일 렌더러로 재작도해
 * 원본 도면과 잉크 픽셀 대조. 추출이 정확하면 diff≈0, 치수 하나만 틀려도 급증.
 *
 * 원리: "AI가 도면을 제대로 읽었는가"를 사람이 아닌 픽셀이 판정 —
 *  재구성 파라미터 → 재작도(결정론) → 원본과 잉크 불일치율(1 − IoU).
 * 한계: 동일 렌더러 폐루프(합성 도면용). 실도면은 SheetRenderer HLR 연동 필요(잔여).
 * usage: node verify-pixel.mjs [--limit N]   (clean 케이스만 — scan은 기하변형 때문에 제외)
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { RENDER } from './gen-drawing.mjs';
import { extractDrawing } from './extract.mjs';
import { gate } from './reconstruct.mjs';

const require = createRequire('C:/Users/gomd9/Downloads/nexysys_1/nexyfab.com/new/package.json');
const sharp = require('sharp');
const __dirname = dirname(fileURLToPath(import.meta.url));
const TD = join(__dirname, 'testdata');

/** 잉크 마스크(임계 128 이진화) → 불일치율 = 1 − |A∩B|/|A∪B| */
async function inkDiff(pngA, pngB) {
  const opts = { resolveWithObject: true };
  const a = await sharp(pngA).greyscale().raw().toBuffer(opts);
  const b = await sharp(pngB).greyscale().raw().toBuffer(opts);
  if (a.info.width !== b.info.width || a.info.height !== b.info.height) return { diff: 1, note: 'size mismatch' };
  let inter = 0, union = 0;
  for (let i = 0; i < a.data.length; i++) {
    const ia = a.data[i] < 128, ib = b.data[i] < 128;
    if (ia || ib) union++;
    if (ia && ib) inter++;
  }
  return { diff: union ? 1 - inter / union : 0, inkA: undefined };
}

const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > -1 ? +process.argv[limitArg + 1] : 10;
const cases = readdirSync(TD)
  .filter((f) => f.endsWith('.gt.json') && !f.includes('-scan'))
  .map((f) => f.replace('.gt.json', ''))
  .slice(0, LIMIT);

const PASS_TH = 0.02; // 잉크 불일치 2% 이하 = 재작도 일치
let pass = 0, ctrlOk = 0;
const rows = [];
for (const name of cases) {
  const gt = JSON.parse(readFileSync(join(TD, `${name}.gt.json`), 'utf8'));
  const origPng = readFileSync(join(TD, `${name}.png`));
  try {
    // 대조군: GT 재작도 → diff≈0 이어야 루프 자체가 건전
    const ctrl = await sharp(Buffer.from(RENDER[gt.type](gt))).png().toBuffer();
    const { diff: ctrlDiff } = await inkDiff(origPng, ctrl);
    if (ctrlDiff < 0.005) ctrlOk++;

    const { intent } = await extractDrawing(join(TD, `${name}.png`));
    if (intent.type !== gt.type || gate(intent).length) {
      rows.push({ name, verdict: 'FAIL', reason: intent.type !== gt.type ? 'type mismatch' : 'gate fail' });
      continue;
    }
    const redrawn = await sharp(Buffer.from(RENDER[intent.type](intent))).png().toBuffer();
    const { diff } = await inkDiff(origPng, redrawn);
    const ok = diff <= PASS_TH;
    if (ok) pass++;
    rows.push({ name, inkDiff: +(diff * 100).toFixed(3) + '%', ctrlDiff: +(ctrlDiff * 100).toFixed(3) + '%', verdict: ok ? 'PASS' : 'FAIL' });
  } catch (e) {
    rows.push({ name, verdict: 'ERR', reason: e.message.slice(0, 80) });
  }
  console.log(JSON.stringify(rows[rows.length - 1]));
  await new Promise((r) => setTimeout(r, 1200));
}
const summary = { cases: cases.length, pixelLoopPass: `${pass}/${cases.length}`, controlSanity: `${ctrlOk}/${cases.length} (GT 재작도 diff<0.5%)`, threshold: `${PASS_TH * 100}%` };
console.log('\n=== PIXEL VERIFY SUMMARY ===');
console.log(JSON.stringify(summary, null, 1));
writeFileSync(join(__dirname, 'pixel-verify-report.json'), JSON.stringify({ date: new Date().toISOString(), summary, rows }, null, 1));
