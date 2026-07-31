/**
 * 2D→3D — E2E 평가 v2 (어휘 5종 + 스캔열화): GT → Gemini → 게이트 → 재구성 → 채점.
 * 채점: 타입 분류 / 파라미터(±0.5mm) / 구멍(개수·위치 ±1mm·지름) / 게이트 / clean vs scan.
 * usage: node run-e2e.mjs [--limit N]
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractDrawing, extractDrawingFromImage } from './extract.mjs';
import { gate, toOpenScad, PARAMS } from './reconstruct.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TD = join(__dirname, 'testdata');
const OUTSCAD = join(__dirname, 'out');
mkdirSync(OUTSCAD, { recursive: true });

const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > -1 ? +process.argv[limitArg + 1] : Infinity;
/**
 * `--only <substr>` — 특정 어휘만 골라 잰다.
 * ⚠ `--limit` 은 **앞에서부터** 자른다. 그래서 뒤쪽 버킷(plate_with_holes·l_bracket)은
 *   한 번도 측정된 적이 없었다 — 「낮은 점수」가 아니라 **표본 0** 이었다.
 *   전량 실행 전에 그 버킷만 확인할 수단이 필요하다.
 */
/**
 * `--web` — **제품이 실제로 쓰는 경로**로 잰다.
 *
 * ★260731 — 이 하네스는 지금까지 `extractDrawing`(CLI: 5어휘·단일콜)만 쟀다. 그런데
 *   `/api/nexyfab/drawing/extract` 가 부르는 것은 `extractDrawingFromImage`
 *   (웹: 11어휘·분류→치수 2단계)다. **어휘도 프롬프트도 실패 양상도 다른 코드**인데
 *   측정된 적이 없었다 — 「측정한 것」과 「배포된 것」이 갈려 있었다.
 */
const WEB = process.argv.includes('--web');
const extractFor = WEB
  ? async (png) => extractDrawingFromImage(readFileSync(png).toString('base64'), 'image/png')
  : (png) => extractDrawing(png);

const onlyArg = process.argv.indexOf('--only');
const ONLY = onlyArg > -1 ? process.argv[onlyArg + 1] : null;
const cases = readdirSync(TD).filter((f) => f.endsWith('.gt.json')).map((f) => f.replace('.gt.json', ''))
  .filter((n) => !ONLY || n.includes(ONLY))
  .slice(0, LIMIT);
if (ONLY) console.log(`[only=${ONLY}] ${cases.length}건`);
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

/**
 * ★260731 — **못 잰 것을 틀린 것으로 세고 있었다.**
 *
 * 종전 요약은 `typeOk / cases.length` 로 정확도를 냈다. 그런데 분자에서 빠진 것 중
 * 상당수는 **오답이 아니라 미측정**이었다 — 7/30 실행 50건 중 22건이 `Gemini 503`
 * (모델 과부하)·JSON 절단으로 판독 자체가 안 됐는데, 그게 「분류 실패」로 집계돼
 * `typeClassification 28/50 (56.0%)` 가 됐다. 실제 측정된 28건은 **28/28** 이다.
 *
 * ⚠ 이 세 가지는 서로 다른 상태다. 뭉치면 어느 쪽도 알 수 없게 된다:
 *     · 측정했고 맞음   · 측정했고 틀림   · **측정 자체가 안 됨**
 * ⚠ 미측정이 있으면 **그 실행은 완결이 아니다.** 정확도를 숫자로 내되 완결 여부를
 *   함께 표기하고, 표본이 0 인 버킷은 「0%」가 아니라 **「표본 없음」**으로 적는다.
 */
const agg = { measured: 0, typeOk: 0, pOk: 0, pTot: 0, hPos: 0, hTot: 0, gateOk: 0, err: 0 };
/** 미측정 사유 분류 — 재시도가 통하는 것(일시)과 아닌 것(항구)을 나눠야 대응이 갈린다. */
const notMeasured = [];
const classifyErr = (m) => {
  if (/Gemini (429|5\d\d)|재시도 소진|fetch failed|ETIMEDOUT|ECONNRESET/i.test(m)) return 'transient_api';
  if (/MAX_TOKENS|empty response|JSON|Unexpected token|Expected/i.test(m)) return 'truncated_or_bad_json';
  if (/Gemini 4\d\d/.test(m)) return 'permanent_api';
  return 'other';
};
const byBucket = {}; // clean/scan × type
const report = [];
for (const name of cases) {
  const gt = JSON.parse(readFileSync(join(TD, `${name}.gt.json`), 'utf8'));
  const bucket = name.endsWith('-scan') ? 'scan' : 'clean';
  const bkey = `${bucket}:${gt.type}`;
  byBucket[bkey] ??= { n: 0, measured: 0, typeOk: 0, pOk: 0, pTot: 0 };
  byBucket[bkey].n++;
  let row;
  try {
    const { intent } = await extractFor(join(TD, `${name}.png`));
    // ★ 여기까지 왔다는 것은 **판독이 실제로 이뤄졌다**는 뜻이다 — 이제부터 채점 대상.
    agg.measured++; byBucket[bkey].measured++;
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
    const reason = classifyErr(e.message);
    notMeasured.push({ name, bucket, reason });
    // ⚠ `type: 'ERR'` 은 **오답이 아니라 미측정**이다. 채점 분모에 넣지 않는다.
    row = { name, bucket, type: 'ERR', measured: false, reason, err: e.message.slice(0, 90) };
  }
  report.push(row);
  console.log(JSON.stringify(row));
  await new Promise((r) => setTimeout(r, 1200));
}
const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + '%' : '-');
const reasons = {};
for (const x of notMeasured) reasons[x.reason] = (reasons[x.reason] ?? 0) + 1;
const M = agg.measured;
const summary = {
  // ── 완결성 먼저 — 정확도는 이 표본 위에서만 의미가 있다.
  cases: cases.length,
  measured: `${M}/${cases.length} (${pct(M, cases.length)})`,
  complete: agg.err === 0,
  notMeasured: agg.err,
  notMeasuredReasons: reasons,
  // ── 정확도 — 분모는 **측정된 것**이다.
  typeClassification: M ? `${agg.typeOk}/${M} (${pct(agg.typeOk, M)})` : '표본 없음',
  paramAccuracy: agg.pTot ? `${agg.pOk}/${agg.pTot} (${pct(agg.pOk, agg.pTot)})` : '표본 없음',
  holePosAccuracy: agg.hTot ? `${agg.hPos}/${agg.hTot} (${pct(agg.hPos, agg.hTot)})` : '표본 없음',
  geometryGatePass: M ? `${agg.gateOk}/${M} (${pct(agg.gateOk, M)})` : '표본 없음',
  byBucket: Object.fromEntries(Object.entries(byBucket).map(([k, v]) => [
    k,
    // ⚠ 표본이 0 인 버킷을 「type 0/5」로 적으면 **전부 틀린 것처럼 읽힌다.**
    v.measured === 0
      ? `표본 없음 (배정 ${v.n}, 측정 0)`
      : `측정 ${v.measured}/${v.n} — type ${v.typeOk}/${v.measured}, params ${v.pOk}/${v.pTot}`,
  ])),
};
if (agg.err) {
  console.log(`
⚠ 미측정 ${agg.err}건 — 이 실행은 완결이 아니다. 아래 정확도는 측정된 ${M}건에 대한 값이다.`);
  for (const [r, c] of Object.entries(reasons)) console.log(`   · ${r}: ${c}`);
}
console.log('\n=== SUMMARY ===');
console.log(JSON.stringify(summary, null, 1));
// ⚠ 두 경로의 결과를 **같은 파일에 덮어쓰지 않는다** — 무엇을 잰 수치인지 사라진다.
writeFileSync(join(__dirname, WEB ? 'e2e-report-web.json' : 'e2e-report.json'),
  JSON.stringify({ date: new Date().toISOString(), path: WEB ? 'web(extractDrawingFromImage, 11어휘 2단계)' : 'cli(extractDrawing, 5어휘 단일콜)', summary, report }, null, 1));
