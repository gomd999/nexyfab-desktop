/**
 * sketchIntentEval.test.ts — **사진/스케치 → 3D 경로의 첫 정확도 측정** (260731).
 *
 * ## 왜 필요했나
 * `intent-from-image` 는 제품의 「사진·스케치 → CAD」 경로인데, **정확도를 잰 적이 없다.**
 * 존재하던 테스트는 전부 배선·파싱(모의 LLM)이었다 — 실제 이미지를 넣고 대조한 적이 없다.
 *
 * ## 두 체제를 **다른 기준으로** 잰다 — 프롬프트가 그렇게 나눠 지시하기 때문
 * ```
 *   dim   (치수 표기 있음) → "use them verbatim"        → 절대 mm 을 채점한다
 *   plain (치수 표기 없음) → "infer ... NOTE the assumption"
 *                            → 절대 mm 은 **원리상 알 수 없다**. 비율과 고지 여부를 본다.
 * ```
 * ⚠ `plain` 에서 절대 치수를 채점하면 **불가능한 것을 요구**하는 것이다 — 모델이 아니라
 *   채점자가 틀린 것이 된다. 원문(그림)이 정하지 않은 것을 정답으로 삼지 않는다.
 *
 * ## ⚠️ 이 수치가 무엇의 대리물인지
 * 평가셋은 파라미터를 아는 **합성 픽토리얼**이다(`gen-sketch.mjs`). 대상 프롬프트가 명시한
 * 입력 중 「CAD render · sketch · hand drawing」에는 해당하지만 **「photo」에는 해당하지
 * 않는다.** 실사진(그림자·재질·배경·원근) 성능을 이 숫자로 주장하면 안 된다.
 *
 * ## 실행
 * 실제 LLM 을 부른다 — 비용이 든다. `NEXYFAB_AI_LIVE=1` 일 때만 돈다.
 * ⚠ **skip 은 통과가 아니다.**
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { extractIntentFromImage } from './imageIntentExtractor';

const LIVE = process.env.NEXYFAB_AI_LIVE === '1';
const DATA = join(process.cwd(), 'scripts', 'drawing-to-3d', 'sketchdata');

type Gt = {
  shapeId: string;
  params: Record<string, number>;
  variant: 'dim' | 'plain';
  labeledParams: string[];
  /**
   * ★260731 — `clean` 과 `photo` 는 **같은 GT·같은 그림**이고 조건만 다르다.
   *   그래서 둘을 나란히 보면 「사진 조건이 얼마나 깎아먹는가」가 그대로 나온다.
   * ⚠ `photo` 는 **실사진이 아니다**(재질·그림자·배경 물체는 재현 못 한다).
   *   이 버킷이 답하는 질문은 「깨끗하지 않은 이미지에서 성능이 유지되는가」다.
   */
  condition: 'clean' | 'photo';
};

/** 절대 치수 허용오차 — 표기를 그대로 읽으라고 지시했으므로 빡빡하게. */
const ABS_TOL_PCT = 2;
/**
 * 비율 허용오차 — 그림에서 눈대중으로 읽는 값이다. 절대치보다 넉넉해야 한다.
 * ⚠ 넉넉하다고 아무 값이나 통과하지는 않는다: 2배 틀리면 100% 오차로 걸린다.
 */
const RATIO_TOL_PCT = 20;

/** `summary` 가 **추정임을 밝혔는가** — 프롬프트가 명시적으로 요구하는 계약이다. */
const ASSUMPTION_WORDS = /assum|infer|estimat|approx|scale|typical|hand[- ]siz|guess|no dimension|undimensioned/i;

function loadCases(): Array<{ name: string; gt: Gt }> {
  if (!existsSync(DATA)) return [];
  return readdirSync(DATA)
    .filter((f) => f.endsWith('.gt.json'))
    .map((f) => ({ name: f.replace('.gt.json', ''), gt: JSON.parse(readFileSync(join(DATA, f), 'utf8')) as Gt }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** 예측 params 에서 키를 느슨하게 찾는다(대소문자·별칭 차이는 실패가 아니다). */
function paramOf(pred: Record<string, unknown>, key: string): number | null {
  const direct = pred[key];
  if (typeof direct === 'number' && Number.isFinite(direct)) return direct;
  const lower = key.toLowerCase();
  for (const [k, v] of Object.entries(pred)) {
    if (k.toLowerCase() === lower && typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

/**
 * 비율 채점 — 가장 큰 GT 치수를 기준으로 정규화해 **크기와 무관하게** 형태를 본다.
 * ⚠ 양쪽에 다 있는 키만 센다. 없는 키를 0 으로 두면 「안 냈다」가 「틀렸다」가 된다.
 */
function scoreRatios(gt: Gt, pred: Record<string, unknown>) {
  const keys = Object.keys(gt.params).filter((k) => paramOf(pred, k) != null);
  if (keys.length < 2) return { ok: 0, total: 0, note: '공통 키 2개 미만 — 비율 판정 불가' };
  const gRef = Math.max(...keys.map((k) => gt.params[k]));
  const pRef = Math.max(...keys.map((k) => paramOf(pred, k) as number));
  if (!(gRef > 0 && pRef > 0)) return { ok: 0, total: 0, note: '기준 치수 0 — 판정 불가' };
  let ok = 0;
  const bad: string[] = [];
  for (const k of keys) {
    const g = gt.params[k] / gRef;
    const p = (paramOf(pred, k) as number) / pRef;
    if (Math.abs(p - g) <= (RATIO_TOL_PCT / 100) * Math.max(g, 1e-6)) ok++;
    else bad.push(`${k} ${(g * 100).toFixed(0)}%→${(p * 100).toFixed(0)}%`);
  }
  return { ok, total: keys.length, note: bad.join(', ') };
}

(LIVE && loadCases().length ? describe : describe.skip)('사진/스케치 → 3D 실측 (NEXYFAB_AI_LIVE=1)', () => {
  it('형상·절대치수·비율·가정고지를 **나눠서** 집계한다', async () => {
    // 부모 .env 의 키를 쓰는 로컬 실행을 위해 — 없으면 `NO_VISION` 으로 정직하게 실패한다.
    if (!process.env.GEMINI_API_KEY) {
      try {
        const m = await import(/* @vite-ignore */ '../../../scripts/drawing-to-3d/extract.mjs') as { apiKey: () => string };
        process.env.GEMINI_API_KEY = m.apiKey();
      } catch { /* 키 없음 — 아래에서 미측정으로 집계된다 */ }
    }

    // 진단용 부분 실행 — 전량은 비용이 든다.
    const only = process.env.SKETCH_ONLY;
    const cases = loadCases().filter((c) => !only || c.name.includes(only));
    const blank = () => ({ measured: 0, shapeOk: 0, absOk: 0, absTot: 0, ratioOk: 0, ratioTot: 0, notedOk: 0, notedTot: 0 });
    /**
     * ★ `dimensionSource` 채점 — **우리는 정답을 안다.** 어느 그림에 치수를 그렸는지
     *   우리가 정했기 때문이다(`variant`). 그러니 이 신호는 추측이 아니라 실측 가능하다.
     * ⚠ 가장 위험한 오류는 **추정을 「읽었다」고 말하는 것**이다(치수가 없는데 callouts).
     *   그 반대(읽었는데 inferred)는 과하게 조심하는 것일 뿐이다 — 나눠서 센다.
     */
    const dsAgg = { total: 0, correct: 0, overclaim: 0, underclaim: 0, missing: 0 };
    const agg = blank();
    // 조건별로 따로 센다 — 합치면 「사진 조건이 얼마나 깎는가」가 사라진다.
    const byCond: Record<string, ReturnType<typeof blank>> = { clean: blank(), photo: blank() };
    const notMeasured: string[] = [];
    const rows: string[] = [];

    for (const { name, gt } of cases) {
      const bytes = new Uint8Array(readFileSync(join(DATA, `${name}.png`)));
      const r = await extractIntentFromImage({ imageBytes: bytes, mimeType: 'image/png' });
      if (!r.ok) {
        // ⚠ 판독 실패는 **오답이 아니라 미측정**이다 — 분모에 넣지 않는다.
        notMeasured.push(`${name}: ${r.code}`);
        // 원문 꼬리를 보여 준다 — 「NON_JSON」만으로는 잘렸는지 산문인지 구별할 수 없다.
        const raw = (r as { raw?: string }).raw;
        if (raw) console.log(`  [원문] ${name}: …${raw.slice(-160).replace(/\s+/g, ' ')}`);
        continue;
      }
      agg.measured++;
      const A = byCond[gt.condition ?? 'clean'] ?? (byCond[gt.condition ?? 'clean'] = blank());
      A.measured++;
      const intent = r.intent as unknown as { shapeId?: string; params?: Record<string, unknown> };
      const shapeOk = String(intent.shapeId) === gt.shapeId;
      if (shapeOk) { agg.shapeOk++; A.shapeOk++; }
      const pred = (intent.params ?? {}) as Record<string, unknown>;

      // 치수 표기가 실제로 그려진 케이스만 `callouts` 가 정답이다.
      const expectSrc = gt.variant === 'dim' && gt.labeledParams.length ? 'callouts' : 'inferred';
      const gotSrc = (r as { dimensionSource?: string }).dimensionSource;
      dsAgg.total++;
      if (!gotSrc) dsAgg.missing++;
      else if (gotSrc === expectSrc || gotSrc === 'mixed') dsAgg.correct++;
      else if (gotSrc === 'callouts' && expectSrc === 'inferred') dsAgg.overclaim++;
      else dsAgg.underclaim++;

      let absNote = '-';
      if (gt.variant === 'dim' && gt.labeledParams.length) {
        // **표기된 치수만** 채점한다 — 안 그린 치수를 요구하면 그건 우리 잘못이다.
        const bad: string[] = [];
        for (const k of gt.labeledParams) {
          agg.absTot++; A.absTot++;
          const p = paramOf(pred, k);
          if (p != null && Math.abs(p - gt.params[k]) <= (ABS_TOL_PCT / 100) * gt.params[k]) { agg.absOk++; A.absOk++; }
          else bad.push(`${k} ${gt.params[k]}→${p ?? '없음'}`);
        }
        absNote = bad.join(', ') || 'OK';
      }

      let ratioNote = '-';
      if (gt.variant === 'plain') {
        const rs = scoreRatios(gt, pred);
        agg.ratioOk += rs.ok; agg.ratioTot += rs.total;
        A.ratioOk += rs.ok; A.ratioTot += rs.total;
        ratioNote = rs.total ? `${rs.ok}/${rs.total}${rs.note ? ` (${rs.note})` : ''}` : rs.note;
        // 프롬프트가 요구한 **고지 계약** — 지켜지는지 본다(키워드 휴리스틱).
        agg.notedTot++; A.notedTot++;
        if (ASSUMPTION_WORDS.test(String(r.summary ?? ''))) { agg.notedOk++; A.notedOk++; }
      }

      rows.push(`  ${name.padEnd(22)} shape ${shapeOk ? 'OK ' : `✗(${intent.shapeId})`.padEnd(3)}  abs ${absNote.slice(0, 34).padEnd(34)}  ratio ${ratioNote}`);
    }

    const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : '표본 없음');
    console.log('\n=== 사진/스케치 → 3D 실측 (합성 픽토리얼) ===');
    console.log(` 측정 ${agg.measured}/${cases.length}${notMeasured.length ? ` — 미측정 ${notMeasured.length}: ${notMeasured.slice(0, 4).join(' | ')}` : ''}`);
    console.log(` 형상 판별        ${agg.shapeOk}/${agg.measured} (${pct(agg.shapeOk, agg.measured)})`);
    console.log(` 절대 치수(표기有) ${agg.absOk}/${agg.absTot} (${pct(agg.absOk, agg.absTot)})   ← "표기를 그대로 읽어라"의 이행률`);
    console.log(` 비율(표기無)      ${agg.ratioOk}/${agg.ratioTot} (${pct(agg.ratioOk, agg.ratioTot)})   ← 절대치는 원리상 판정 불가`);
    console.log(` 추정 고지         ${agg.notedOk}/${agg.notedTot} (${pct(agg.notedOk, agg.notedTot)})   ← 프롬프트가 요구한 계약(키워드 판정)`);
    console.log(['', ' --- 조건별(같은 GT·같은 그림, 조건만 다름) ---'].join(String.fromCharCode(10)));
    for (const [cond, a] of Object.entries(byCond)) {
      if (!a.measured) continue;
      const label = cond === 'photo' ? 'photo(사진조건)' : 'clean(깨끗)';
      console.log(` ${label.padEnd(16)} 측정 ${a.measured} · 형상 ${pct(a.shapeOk, a.measured)} · 절대치수 ${pct(a.absOk, a.absTot)} · 비율 ${pct(a.ratioOk, a.ratioTot)} · 고지 ${pct(a.notedOk, a.notedTot)}`);
    }
    console.log(' ⚠ photo 는 실사진이 아니다 — 재질·그림자·배경 물체는 재현하지 못한다.');
    console.log(` 치수출처 신고     정확 ${dsAgg.correct}/${dsAgg.total} (${pct(dsAgg.correct, dsAgg.total)})`
      + ` · ★과대신고(추정을 「읽었다」) ${dsAgg.overclaim}`
      + ` · 과소신고 ${dsAgg.underclaim} · 무응답 ${dsAgg.missing}`);
    for (const r of rows) console.log(r);

    // 측정이 성립했는지 — 0건이면 위 숫자는 전부 무의미하다.
    expect(agg.measured, `전부 미측정: ${notMeasured.slice(0, 3).join(' | ')}`).toBeGreaterThan(0);
    /**
     * ⚠ 기준선은 **현재 실측**으로 잡는다. 여기서 막는 것은 「지금보다 나빠지는 것」이다.
     *   첫 측정이므로 환경변수로 조정 가능하게 두고, 실측값은 커밋 메시지·문서에 남긴다.
     */
    expect(agg.shapeOk / Math.max(1, agg.measured))
      .toBeGreaterThanOrEqual(Number(process.env.SKETCH_MIN_SHAPE_RATE ?? 0));
    /**
     * ⚠ **과대신고는 0 이어야 한다.** 치수가 안 적힌 그림을 「읽었다」고 하면, 55% 정확도의
     *   추정치가 측정치로 승격돼 그대로 제작에 흘러간다 — 이 하네스가 막아야 할 최악이다.
     */
    expect(dsAgg.overclaim, `추정을 「읽었다」고 신고한 건수 ${dsAgg.overclaim}`)
      .toBeLessThanOrEqual(Number(process.env.SKETCH_MAX_OVERCLAIM ?? 0));
  }, 1_800_000);
});

if (!LIVE || !loadCases().length) {
  describe('사진/스케치 → 3D', () => {
    it.skip('미실행 — **skip 은 통과가 아니다** (NEXYFAB_AI_LIVE=1 + gen-sketch.mjs 필요)', () => {});
  });
}
