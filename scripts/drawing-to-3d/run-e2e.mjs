/**
 * 2D→3D v1 — E2E 평가: 합성 도면(GT) → Gemini 추출 → 게이트 → 재구성 → 채점.
 * 채점: 치수(±0.5mm)·구멍 수·구멍 위치(±1mm 최근접 매칭)·지름 — GT 대비.
 * usage: node run-e2e.mjs
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractDrawing } from './extract.mjs';
import { gate, toOpenScad } from './reconstruct.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TD = join(__dirname, 'testdata');
const OUTSCAD = join(__dirname, 'out');
mkdirSync(OUTSCAD, { recursive: true });

const cases = readdirSync(TD).filter((f) => f.endsWith('.gt.json')).map((f) => f.replace('.gt.json', ''));
const DIM_TOL = 0.5, POS_TOL = 1.0;

function score(gt, ex) {
  const s = { dims: 0, dimsTotal: 3, holeCount: false, holePos: 0, holeDia: 0, holesTotal: gt.holes.length, errors: [] };
  for (const k of ['width', 'depth', 'thickness']) {
    if (Math.abs((ex[k] ?? NaN) - gt[k]) <= DIM_TOL) s.dims++;
    else s.errors.push(`${k}: gt ${gt[k]} vs ${ex[k]}`);
  }
  const exHoles = [...(ex.holes ?? [])];
  s.holeCount = exHoles.length === gt.holes.length;
  if (!s.holeCount) s.errors.push(`hole count: gt ${gt.holes.length} vs ${exHoles.length}`);
  for (const gh of gt.holes) {
    let best = -1, bd = Infinity;
    exHoles.forEach((eh, i) => {
      const dd = Math.hypot(eh.x - gh.x, eh.y - gh.y);
      if (dd < bd) { bd = dd; best = i; }
    });
    if (best >= 0 && bd <= POS_TOL) {
      s.holePos++;
      if (Math.abs(exHoles[best].d - gh.d) <= DIM_TOL) s.holeDia++;
      exHoles.splice(best, 1);
    } else s.errors.push(`hole(${gh.x},${gh.y}) unmatched (best dist ${bd.toFixed(1)})`);
  }
  return s;
}

let totDim = 0, totDimN = 0, totPos = 0, totPosN = 0, totDia = 0, cntOk = 0, gateOk = 0;
const report = [];
for (const name of cases) {
  const gt = JSON.parse(readFileSync(join(TD, `${name}.gt.json`), 'utf8'));
  let row;
  try {
    const { intent } = await extractDrawing(join(TD, `${name}.png`));
    const gerrs = gate(intent);
    if (gerrs.length === 0) {
      gateOk++;
      writeFileSync(join(OUTSCAD, `${name}.scad`), toOpenScad(intent));
    }
    const s = score(gt, intent);
    totDim += s.dims; totDimN += s.dimsTotal;
    totPos += s.holePos; totPosN += s.holesTotal; totDia += s.holeDia;
    if (s.holeCount) cntOk++;
    row = { name, dims: `${s.dims}/3`, holes: `${s.holePos}/${s.holesTotal}`, dia: `${s.holeDia}/${s.holesTotal}`, gate: gerrs.length === 0 ? 'PASS' : 'FAIL', conf: intent.confidence, err: s.errors.join(' | ') || '-' };
  } catch (e) {
    row = { name, dims: '-', holes: '-', dia: '-', gate: 'ERR', err: e.message.slice(0, 80) };
  }
  report.push(row);
  console.log(JSON.stringify(row));
  await new Promise((r) => setTimeout(r, 1500)); // rate limit 완화
}
const summary = {
  cases: cases.length,
  dimAccuracy: `${totDim}/${totDimN} (${((totDim / totDimN) * 100).toFixed(1)}%)`,
  holeCountOk: `${cntOk}/${cases.length}`,
  holePosAccuracy: `${totPos}/${totPosN} (${((totPos / totPosN) * 100).toFixed(1)}%)`,
  holeDiaAccuracy: `${totDia}/${totPosN}`,
  geometryGatePass: `${gateOk}/${cases.length}`,
};
console.log('\n=== SUMMARY ===');
console.log(JSON.stringify(summary, null, 1));
writeFileSync(join(__dirname, 'e2e-report.json'), JSON.stringify({ date: new Date().toISOString(), summary, report }, null, 1));
