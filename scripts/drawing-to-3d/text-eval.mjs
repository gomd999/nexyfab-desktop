/**
 * text-eval.mjs — **텍스트 → 3D 의 치수 정확도**를 잰다 (260731).
 *
 * ## 왜 만들었나 — 기존 평가가 재지 않던 것
 * `ai-path-live.test.ts` 는 **게이트를 통과했는가**만 본다. 그런데 프롬프트에는
 * `300x200`, `두께 12mm` 처럼 **정답이 그대로 적혀 있다.** 그걸 아무도 대조하지
 * 않으므로 **30×200 이 나와도 「성공」**이다 — 「3D 가 만들어졌는가」와
 * 「맞는 3D 인가」는 다르다.
 *
 * ## 이 하네스가 재는 것 — **명시 치수 재현율**
 * 사용자가 **말로 적은 치수**가 결과 파라미터에 살아 있는가.
 *
 * ⚠ **이것은 재현율이지 정확도가 아니다.** 무엇을 증명하고 무엇을 증명하지 않는지:
 *   · 증명함   — 사용자가 말한 숫자가 사라지거나 단위가 틀리지 않았다.
 *   · 증명 못함 — 그 숫자가 **옳은 축**에 붙었는지(가로/세로 뒤바뀜은 못 잡는다).
 *   축 배정까지 채점하려면 어휘별 축 규약이 필요한데, `300x200` 같은 표기는
 *   원문 자체가 축을 확정하지 않는다. **원문이 정하지 않은 것을 정답으로 삼지 않는다.**
 *
 * ⚠ 치수는 **소비하며** 매칭한다 — `50x50x5` 의 두 `50` 은 서로 다른 파라미터여야 한다.
 *   한 값이 두 번 세어지면 재현율이 부풀려진다.
 *
 * ## 정직 규약 (run-e2e.mjs 와 동일)
 * 측정 실패(API·JSON)는 **오답이 아니라 미측정**이다. 분모에 넣지 않고 따로 센다.
 *
 * usage: node text-eval.mjs [--only <substr>] [--repeat N]
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { textToAssembly } from './from-text.mjs';
import { buildAssembly } from './assembly.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * 고정 케이스 — `ai-path-live.test.ts` 와 **같은 프롬프트**를 쓴다(과거 수치와 비교 가능).
 * `expect` 는 원문에 **명시된** 치수만 mm 로 적는다. 추론해야 하는 값은 넣지 않는다.
 */
const CASES = [
  { dom: '기계', text: '두께 12mm 강판 300x200 에 M10 볼트홀 6개', expect: [12, 300, 200], holes: 6 },
  { dom: '기계', text: '지름 50mm 길이 400mm 스테인리스 축', expect: [50, 400] },
  { dom: '기계', text: '앵글 50x50x5 로 만든 1000mm 프레임 4변', expect: [50, 50, 5, 1000] },
  // 단위 환산이 걸린 케이스 — `3m` 이 `3` 으로 남으면 1000배 틀린 3D 가 된다.
  { dom: '토목', text: '높이 3m 길이 10m 옹벽 — 저판 두께 400mm', expect: [3000, 400] },
  { dom: '건축', text: '가로 6m 세로 4m 높이 3m 방 한 칸, 벽 두께 200mm', expect: [6000, 4000, 3000, 200] },
  { dom: '조경', text: '폭 1.5m 길이 5m 목재 데크 — 장선 간격 400mm', expect: [1500, 5000, 400] },
  { dom: '인테리어', text: '길이 2400 깊이 600 높이 900 카운터', expect: [2400, 600, 900] },
  { dom: '기계', text: '외경 100 내경 80 길이 500 파이프', expect: [100, 80, 500] },
];

const onlyArg = process.argv.indexOf('--only');
const ONLY = onlyArg > -1 ? process.argv[onlyArg + 1] : null;
const repArg = process.argv.indexOf('--repeat');
const REPEAT = repArg > -1 ? Number(process.argv[repArg + 1]) : 1;
const cases = CASES.filter((c) => !ONLY || c.text.includes(ONLY) || c.dom.includes(ONLY));

/** 어셈블리에서 **치수로 볼 수 있는 수**를 전부 모은다(파트 params + civilAlignment). */
function collectNumbers(asm) {
  const out = [];
  const walk = (v) => {
    if (typeof v === 'number' && Number.isFinite(v)) out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  for (const p of asm?.parts ?? []) walk(p.params);
  if (asm?.civilAlignment) walk(asm.civilAlignment);
  return out;
}

/** 명시 치수 재현율 — 값을 **소비하며** 매칭한다. */
function scoreDims(expected, numbers) {
  const pool = [...numbers];
  const hit = [], miss = [];
  for (const want of expected) {
    const tol = Math.max(0.5, Math.abs(want) * 0.001);
    const i = pool.findIndex((n) => Math.abs(n - want) <= tol);
    if (i >= 0) { hit.push(want); pool.splice(i, 1); }
    else miss.push(want);
  }
  return { hit: hit.length, total: expected.length, miss };
}

/** 구멍 개수 — 어휘마다 표현이 달라 여러 형태를 본다. 못 찾으면 **미측정**(0 아님). */
function countHoles(asm) {
  let n = null;
  for (const p of asm?.parts ?? []) {
    const q = p.params ?? {};
    if (Array.isArray(q.holes)) n = (n ?? 0) + q.holes.length;
    else if (Number.isFinite(Number(q.boltCount))) n = (n ?? 0) + Number(q.boltCount);
    else if (Number.isFinite(Number(q.holeCount))) n = (n ?? 0) + Number(q.holeCount);
  }
  return n;
}

const agg = { measured: 0, gateOk: 0, dimHit: 0, dimTot: 0, holeOk: 0, holeTot: 0 };
const notMeasured = [];
const rows = [];

for (let rep = 0; rep < REPEAT; rep++) {
  for (const c of cases) {
    const t0 = Date.now();
    try {
      /**
       * ★260731 — 지연이 2.2s~118.5s 로 흔들리는데 **원인 데이터가 없었다.**
       *   답한 모델과 수리 라운드를 함께 기록한다 — 「느리다」로는 고칠 수 없다.
       */
      const { assembly, gateErrors, model, repairRounds, fallbackReasons, usage } = await textToAssembly(c.text);
      agg.measured++;
      const nums = collectNumbers(assembly);
      const ds = scoreDims(c.expect, nums);
      agg.dimHit += ds.hit; agg.dimTot += ds.total;
      /**
       * 게이트: `civilAlignment` 로 간 것도 **성공**이다 — 선형 요청은 `parts` 가 아니라
       * 그쪽으로 가는 것이 프롬프트가 지시한 동작이다(과거 하네스가 이걸 실패로 찍었다).
       */
      const errs = gateErrors ?? buildAssembly(assembly)?.gateErrors ?? [];
      const gateOk = assembly?.civilAlignment ? true : (!errs.length && (assembly?.parts ?? []).length > 0);
      if (gateOk) agg.gateOk++;
      let holes = '-';
      if (c.holes != null) {
        const got = countHoles(assembly);
        // ⚠ 못 찾은 것(null)은 「0개」가 아니다 — 분모에 넣지 않는다.
        if (got == null) holes = '미측정';
        else { agg.holeTot++; if (got === c.holes) { agg.holeOk++; holes = 'OK'; } else holes = `${got}≠${c.holes}`; }
      }
      rows.push({
        dom: c.dom, text: c.text.slice(0, 28), gate: gateOk ? 'PASS' : 'FAIL',
        dims: `${ds.hit}/${ds.total}`, miss: ds.miss.join(',') || '-', holes,
        parts: (assembly?.parts ?? []).length, ms: Date.now() - t0,
        model: Array.isArray(model) ? model.join('+') : String(model ?? '?'), rounds: repairRounds ?? 0,
        // ★ 폴백 사유 — 이게 있어야 「왜 12배 느린가」를 고칠 수 있다.
        fellBack: (fallbackReasons ?? []).join(' | ') || '-',
        outTok: usage?.out ?? null, withSchema: usage?.schema ?? null,
      });
    } catch (e) {
      const msg = String(e?.message ?? e);
      const reason = /429|5\d\d|재시도 소진|fetch failed/i.test(msg) ? 'transient_api'
        : /MAX_TOKENS|JSON|Unexpected|Expected/i.test(msg) ? 'truncated_or_bad_json' : 'other';
      notMeasured.push({ text: c.text.slice(0, 28), reason });
      rows.push({ dom: c.dom, text: c.text.slice(0, 28), gate: 'ERR', measured: false, reason, err: msg.slice(0, 70) });
    }
    console.log(JSON.stringify(rows.at(-1)));
  }
}

const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + '%' : '표본 없음');
const N = cases.length * REPEAT;
const reasons = {};
for (const x of notMeasured) reasons[x.reason] = (reasons[x.reason] ?? 0) + 1;
const summary = {
  cases: N,
  measured: `${agg.measured}/${N} (${pct(agg.measured, N)})`,
  complete: notMeasured.length === 0,
  notMeasuredReasons: reasons,
  gatePass: agg.measured ? `${agg.gateOk}/${agg.measured} (${pct(agg.gateOk, agg.measured)})` : '표본 없음',
  // ★ 새로 재는 것 — 「만들어졌는가」가 아니라 「말한 치수가 살아 있는가」
  statedDimRecall: `${agg.dimHit}/${agg.dimTot} (${pct(agg.dimHit, agg.dimTot)})`,
  holeCount: agg.holeTot ? `${agg.holeOk}/${agg.holeTot}` : '표본 없음',
  // ★ 지연 — 평균은 쓸모없다. **꼬리**가 사용자를 기다리게 한다.
  latency: (() => {
    const ms = rows.filter((r) => typeof r.ms === 'number').map((r) => r.ms).sort((a, b) => a - b);
    if (!ms.length) return '표본 없음';
    const q = (p) => ms[Math.min(ms.length - 1, Math.floor(ms.length * p))];
    return `p50 ${(q(0.5) / 1000).toFixed(1)}s · p90 ${(q(0.9) / 1000).toFixed(1)}s · 최대 ${(ms.at(-1) / 1000).toFixed(1)}s`;
  })(),
  caveat: '재현율은 축 배정(가로/세로 뒤바뀜)을 검증하지 않는다 — 원문이 축을 확정하지 않기 때문.',
};
if (notMeasured.length) console.log(`\n⚠ 미측정 ${notMeasured.length}건 — 이 실행은 완결이 아니다.`);
console.log('\n=== SUMMARY ===');
console.log(JSON.stringify(summary, null, 1));
writeFileSync(join(__dirname, 'text-eval-report.json'), JSON.stringify({ date: new Date().toISOString(), summary, rows }, null, 1));
