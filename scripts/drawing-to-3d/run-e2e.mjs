/**
 * 2D→3D — E2E 평가 v2 (어휘 5종 + 스캔열화): GT → Gemini → 게이트 → 재구성 → 채점.
 * 채점: 타입 분류 / 파라미터(±0.5mm) / 구멍(개수·위치 ±1mm·지름) / 게이트 / clean vs scan.
 * usage: node run-e2e.mjs [--limit N]
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractDrawing } from './extract.mjs';
import { gate, toOpenScad, PARAMS } from './reconstruct.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TD = join(__dirname, 'testdata');
const OUTSCAD = join(__dirname, 'out');
mkdirSync(OUTSCAD, { recursive: true });

const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > -1 ? +process.argv[limitArg + 1] : Infinity;
const cases = readdirSync(TD).filter((f) => f.endsWith('.gt.json')).map((f) => f.replace('.gt.json', '')).slice(0, LIMIT);
const DIM_TOL = 0.5, POS_TOL = 1.0;

function scoreParams(gt, ex) {
  const params = PARAMS[gt.type];
  let ok = 0;
  const errs = [];
  for (const k of params) {
    if (Math.abs((ex[k] ?? NaN) - gt[k]) <= DIM_TOL) ok++;
    else errs.push(`${k}: gt ${gt[k]} vs ${ex[k]}`);
  }
  return { ok, total: params.length, errs };
}
function scoreHoles(gt, ex) {
  if (!gt.holes) return null;
  const exH = [...(ex.holes ?? [])];
  const s = { count: exH.length === gt.holes.length, pos: 0, dia: 0, total: gt.holes.length, errs: [] };
  for (const gh of gt.holes) {
    let bi = -1, bd = Infinity;
    exH.forEach((eh, i) => { const dd = Math.hypot(eh.x - gh.x, eh.y - gh.y); if (dd < bd) { bd = dd; bi = i; } });
    if (bi >= 0 && bd <= POS_TOL) {
      s.pos++;
      if (Math.abs(exH[bi].d - gh.d) <= DIM_TOL) s.dia++;
      exH.splice(bi, 1);
    } else s.errs.push(`hole(${gh.x},${gh.y}) unmatched`);
  }
  return s;
}

const agg = { typeOk: 0, pOk: 0, pTot: 0, hPos: 0, hTot: 0, gateOk: 0, err: 0 };
const byBucket = {}; // clean/scan × type
const report = [];
for (const name of cases) {
  const gt = JSON.parse(readFileSync(join(TD, `${name}.gt.json`), 'utf8'));
  const bucket = name.endsWith('-scan') ? 'scan' : 'clean';
  const bkey = `${bucket}:${gt.type}`;
  byBucket[bkey] ??= { n: 0, typeOk: 0, pOk: 0, pTot: 0 };
  byBucket[bkey].n++;
  let row;
  try {
    const { intent } = await extractDrawing(join(TD, `${name}.png`));
    const typeOk = intent.type === gt.type;
    if (typeOk) { agg.typeOk++; byBucket[bkey].typeOk++; }
    const ps = typeOk ? scoreParams(gt, intent) : { ok: 0, total: PARAMS[gt.type].length, errs: [`type: gt ${gt.type} vs ${intent.type}`] };
    agg.pOk += ps.ok; agg.pTot += ps.total;
    byBucket[bkey].pOk += ps.ok; byBucket[bkey].pTot += ps.total;
    const hs = typeOk ? scoreHoles(gt, intent) : null;
    if (hs) { agg.hPos += hs.pos; agg.hTot += hs.total; }
    const gerrs = typeOk ? gate(intent) : ['type mismatch'];
    if (gerrs.length === 0) { agg.gateOk++; writeFileSync(join(OUTSCAD, `${name}.scad`), toOpenScad(intent)); }
    row = {
      name, bucket, type: typeOk ? 'OK' : `${gt.type}→${intent.type}`,
      params: `${ps.ok}/${ps.total}`, holes: hs ? `${hs.pos}/${hs.total}` : '-',
      gate: gerrs.length === 0 ? 'PASS' : 'FAIL',
      err: [...ps.errs, ...(hs?.errs ?? [])].slice(0, 3).join(' | ') || '-',
    };
  } catch (e) {
    agg.err++;
    row = { name, bucket, type: 'ERR', err: e.message.slice(0, 90) };
  }
  report.push(row);
  console.log(JSON.stringify(row));
  await new Promise((r) => setTimeout(r, 1200));
}
const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + '%' : '-');
const summary = {
  cases: cases.length,
  typeClassification: `${agg.typeOk}/${cases.length} (${pct(agg.typeOk, cases.length)})`,
  paramAccuracy: `${agg.pOk}/${agg.pTot} (${pct(agg.pOk, agg.pTot)})`,
  holePosAccuracy: agg.hTot ? `${agg.hPos}/${agg.hTot} (${pct(agg.hPos, agg.hTot)})` : '-',
  geometryGatePass: `${agg.gateOk}/${cases.length}`,
  apiErrors: agg.err,
  byBucket: Object.fromEntries(Object.entries(byBucket).map(([k, v]) => [k, `type ${v.typeOk}/${v.n}, params ${v.pOk}/${v.pTot}`])),
};
console.log('\n=== SUMMARY ===');
console.log(JSON.stringify(summary, null, 1));
writeFileSync(join(__dirname, 'e2e-report.json'), JSON.stringify({ date: new Date().toISOString(), summary, report }, null, 1));
