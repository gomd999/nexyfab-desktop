/**
 * 2D→3D — Gemini Vision 도면 추출기 v2 (어휘 5종, ② 도면 이해 층).
 * 도면 PNG → 구조화 intent JSON (responseSchema 강제, temperature 0).
 * 원칙: AI는 "이해"만 담당 — 형상 생성·검증은 결정론 층(reconstruct/verify).
 * usage: node extract.mjs testdata/flange-04.png
 */
import { readFileSync } from 'node:fs';

export function apiKey() {
  // 1순위: 환경변수 (사이트 서버·Railway·프로덕션에서 이 경로로 동작).
  const envKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (envKey) return envKey;
  // 2순위(로컬 CLI 개발): parent .env 파일. 여러 후보 경로 시도.
  for (const p of [
    process.env.NEXYFAB_ENV_PATH,
    'C:/Users/gomd9/Downloads/nexysys_1/.env',
    new URL('../../../../.env', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  ].filter(Boolean)) {
    try {
      const m = readFileSync(p, 'utf8').match(/^GEMINI_API_KEY=(\S+)/m);
      if (m) return m[1];
    } catch { /* 다음 후보 */ }
  }
  throw new Error('GEMINI_API_KEY not found (set env var or parent .env)');
}

const NUM = { type: 'NUMBER' };
// 원 5종 스키마 — run-e2e 하네스가 쓰는 단일콜 경로(검증됨). 웹 11종은 아래 two-stage.
export const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    type: { type: 'STRING', enum: ['plate_with_holes', 'stepped_plate', 'l_bracket', 'flange', 'bent_sheet', 'unknown'] },
    unit: { type: 'STRING' },
    width: NUM, depth: NUM, thickness: NUM,
    holes: { type: 'ARRAY', items: { type: 'OBJECT', properties: { x: NUM, y: NUM, d: NUM }, required: ['x', 'y', 'd'] } },
    stepWidth: NUM, stepThickness: NUM,
    legA: NUM, legB: NUM,
    outerDia: NUM, boreDia: NUM, bcd: NUM, boltHoleD: NUM, boltCount: NUM,
    webWidth: NUM, flangeHeight: NUM, length: NUM,
    confidence: NUM,
  },
  required: ['type', 'confidence'],
};

/**
 * 추출 재시도 상한 (260802).
 *
 * ⚠ 결측 재시도를 넣으면서 케이스당 호출이 **최대 3배**가 됐고, 그것이 측정 자체를
 *   망가뜨렸다: 50장 전량 실행에서 `apiErrors 22/50` — 앞쪽 버킷은 정상인데 뒤쪽
 *   버킷이 통째로 0 이었다(케이스 종류가 아니라 **실행 순서**를 따라 실패 = 호출 한도).
 *   **측정에도 예산이 있고, 넘으면 측정이 대상을 망가뜨린다.**
 * ⚠ 재시도의 효과는 **아직 입증되지 않았다**(3회 중앙값이 수정 전과 겹친다).
 *   입증 안 된 기능에 호출을 3배 쓰지 않는다 — 2회(최초 1 + 재시도 1)로 둔다.
 */
const EXTRACT_MAX_ATTEMPTS = 2;

const PROMPT = `기계 제작 도면(3각법 정투상, mm)을 판독해 파라메트릭 JSON으로 추출하라.

부품 유형을 먼저 분류하고 해당 필드만 채워라:
1. plate_with_holes — 직사각 평판+원형 구멍: width(TOP 가로), depth(TOP 세로), thickness, holes[{x,y,d}]
   · TOP VIEW 좌하단이 원점(0,0), 오른쪽 +x, 위쪽 +y. "(nEA)"=동일 지름 구멍 개수.
   · 위치 치수가 1개 구멍에만 있으면 나머지는 대칭 배치와 축척으로 계산.
2. stepped_plate — 단차 평판(FRONT VIEW에 계단 프로파일, 구멍 없음): width, depth, thickness(최대 두께), stepWidth(단차 구간 가로 길이), stepThickness(단차 구간 두께)
3. l_bracket — L형 브래킷(SIDE VIEW에 L 프로파일): legA(수평 다리 길이), legB(수직 다리 높이), width(부재 폭=TOP 세로), thickness
4. flange — 원형 플랜지(TOP VIEW에 동심원+볼트서클): outerDia(외경), boreDia(중앙 구멍 지름), thickness, bcd(볼트서클 지름 B.C.D.), boltHoleD(볼트구멍 지름), boltCount(볼트구멍 개수 — 도면의 원을 세거나 "⌀d×n" 주석)
5. bent_sheet — U채널 절곡 판금(SIDE VIEW에 U 프로파일): webWidth(웨브 폭), flangeHeight(플랜지 높이), length(부재 길이), thickness(판 두께, "t=" 주석)

규칙:
- 치수선·주석에 인쇄된 숫자를 그대로 읽어라. 치수가 없는 값만 축척으로 계산.
- 스캔 품질이 낮아도(기울어짐·흐림·저대비) 최선을 다해 판독하라.
- 판별 불가 시 type='unknown'.`;

/**
 * @param extra 재시도 시 덧붙일 지시 — **무엇이 빠졌는지** 알려 준다.
 *
 * ⚠ 260802 — `temperature: 0` 이라 **같은 요청을 다시 보내면 같은 답이 온다.**
 *   결측 재시도를 넣고도 효과가 없던 이유가 이것이었다(실측: 재측정 3회 중앙값이
 *   수정 전과 동일한 86.5%). 재시도가 의미를 가지려면 **요청이 달라져야** 한다 —
 *   온도를 올리는 대신 **빠진 필드를 지목**한다(지어내라는 게 아니라 어디를 보라는 것).
 */
async function callGemini(img, model, mimeType = 'image/png', extra = '') {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey()}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ inline_data: { mime_type: mimeType, data: img } }, { text: PROMPT + extra }] }],
      // NOTE: leave thinking ENABLED — gemini-2.5-flash needs it to emit valid
      // number literals under responseSchema; disabling it (thinkingBudget:0)
      // made bent_sheet extractions produce degenerate floats (80e-1500000).
      // A generous output cap only guards against the rare 65KB runaway; the
      // retry in extractDrawing handles transient malformed JSON.
      generationConfig: {
        temperature: 0,
        response_mime_type: 'application/json',
        response_schema: RESPONSE_SCHEMA,
        maxOutputTokens: 8192,
      },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  const text = j.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('empty response: ' + JSON.stringify(j).slice(0, 200));
  return { text, usage: j.usageMetadata };
}

/**
 * Repair the two malformed-number patterns gemini-2.5-flash emits under
 * responseSchema on hard/scan drawings, WITHOUT changing any legitimate value:
 *   1. degenerate exponent — a fine mantissa + garbage power, e.g.
 *      "width":80.0000142e-1500000  → drop the ≥4-digit exponent → 80.0000142
 *   2. duplicated/run-on digits producing an over-long integer that is really
 *      a truncation artifact is NOT repaired here (left to retry) — we only
 *      touch the exponent, which is provably not a real dimension (no part is
 *      1e4000 mm). Conservative by design: never invents a number.
 */
export function repairJsonNumbers(text) {
  return text
    // 1. degenerate exponent: 80.0142e-1500000 → 80.0142
    .replace(/(-?\d+(?:\.\d+)?)[eE][+-]?\d{4,}/g, '$1')
    // 2. runaway decimal: 60.00000000000001421085…(수백 자리) → 소수 15자리로 절단.
    //    gemini-2.5-flash가 자주 빠지는 폭주 패턴(뒤가 MAX_TOKENS로 잘려도 이 필드는 복구).
    .replace(/(-?\d+\.\d{15})\d{16,}/g, '$1');
}

export async function extractDrawing(pngPath, { model = 'gemini-2.5-flash' } = {}) {
  const img = readFileSync(pngPath).toString('base64');
  // Degraded scans occasionally make the model emit a degenerate number literal
  // (e.g. width=80e-1500000) that breaks JSON.parse. Three-layer recovery:
  //   (a) repair the known garbage-exponent pattern in-place, then re-parse;
  //   (b) retry the API call (EXTRACT_MAX_ATTEMPTS 회 — 260802 에 3→2 로 줄였다);
  //   (c) if all fail, the caller (run-e2e) records ERR truthfully — never mask.
  /**
   * ★260802 — **결측 응답을 성공으로 반환하고 있었다.**
   *
   * 재시도는 **JSON 파싱 실패**만 다뤘다. 파싱은 되는데 `flange` 의 `boreDia`·`bcd`·
   * `boltHoleD`·`boltCount` 가 **동시에 비어 오는 회차**가 있고, 그게 그대로 반환됐다.
   * 실측(`flange-04-scan` 4회): 1회 결측 · 3회 완전 — **25% 가 결측인데 성공 취급**이었다.
   *
   * ⚠ 비운 값을 **우리가 채우지 않는다.** 추정으로 메우면 틀린 치수로 3D 가 만들어진다 —
   *   대신 **같은 요청을 다시** 한다(비용은 실패 회차에만).
   * ⚠ 끝까지 결측이면 **결측인 채로** 내보내고 이름으로 고지한다. 게이트가 잡고 사용자가
   *   되묻는 편이, 지어낸 값으로 통과하는 것보다 낫다.
   * ⚠ 두 추출 경로(`extractDrawing` CLI·e2e / `extractDrawingFromImage` 웹)가 **따로 있다.**
   *   한쪽만 고치면 다른 쪽이 조용히 옛 동작을 유지한다 — 실제로 그럴 뻔했다.
   */
  let lastErr;
  let best = null, bestMissing = null;
  for (let attempt = 0; attempt < EXTRACT_MAX_ATTEMPTS; attempt++) {
    let intent = null, usage2 = null, repaired = false;
    /**
     * 재시도에는 **빠진 필드를 지목**해 덧붙인다. 같은 요청을 반복하면 `temperature: 0`
     * 이라 같은 답이 온다 — 요청이 달라져야 재시도가 의미를 갖는다.
     * ⚠ 「값을 만들어라」가 아니라 **「어느 치수를 다시 보라」**다. 지어내라고 하지 않는다.
     */
    /**
     * ⚠⚠ 260802 — 힌트를 그냥 붙였다가 **타입 분류가 흔들렸다**(실측: scan:bent_sheet
     *   5/5 → 4/5 → 3/5, 채점 분모가 52 → 48 → 32 로 줄어 「100%」가 살아남은 케이스만
     *   센 값이 됐다). 이 프롬프트는 **분류와 추출을 함께** 하므로, 빠진 치수를 지목하면
     *   분류까지 끌려간다. **분모가 줄어든 100% 는 개선이 아니라 선택 편향이다.**
     *   → 재시도에서는 **직전 타입을 고정**해 분류가 바뀔 여지를 없앤다.
     */
    const hint = bestMissing?.length
      ? `\n\n⚠ 이 도면의 부품 유형은 '${best?.intent?.type}' 로 이미 확정됐다 — 유형을 바꾸지 마라.`
        + ` 직전 판독에서 ${bestMissing.join('·')} 가 비어 있었다. 그 치수가 표기된 뷰·치수선·주석을`
        + ' 다시 찾아 읽어라. 도면에 정말 없으면 축척과 대칭으로 계산하되, 근거 없이 지어내지는 마라.'
      : '';
    try {
      const { text, usage } = await callGemini(img, model, 'image/png', hint);
      usage2 = usage;
      try { intent = JSON.parse(text); }
      catch {
        const fixed = repairJsonNumbers(text);
        if (fixed !== text) { intent = JSON.parse(fixed); repaired = true; }
      }
    } catch (e) { lastErr = e instanceof Error ? e : new Error(String(e)); }
    if (!intent) { lastErr = lastErr ?? new Error('bad extraction JSON (unrepairable)'); continue; }
    const need = TYPE_FIELDS[String(intent.type ?? '')] ?? [];
    const missing = need.filter((k) => intent[k] == null || Number.isNaN(Number(intent[k])));
    // 결측이 더 적은 응답을 남긴다 — 마지막 응답이 항상 나은 것은 아니다.
    if (!best || missing.length < bestMissing.length) { best = { intent, usage: usage2, model, repaired }; bestMissing = missing; }
    if (!missing.length) return best;
  }
  if (!best) throw lastErr ?? new Error('extract failed');
  best.intent.missingFields = bestMissing;
  best.intent.confidence = Math.min(Number(best.intent.confidence) || 0, 0.4);
  best.intent.missingNote = `도면에서 ${bestMissing.join('·')} 를 읽지 못했다(재시도 후에도). `
    + '값을 추정해 채우지 않았다 — 그 치수를 알려 주거나 해당 부분이 보이는 도면을 주세요.';
  return best;
}

/* ── 웹 업로드용 two-stage 추출 (어휘 11종) ─────────────────────────────────
   단일 플랫 스키마에 11종 필드를 모두 넣으면 모델이 타입 간 필드를 혼동해(예:
   bent_sheet 인데 box 의 width 를 채움) 치수를 누락한다. 그래서 ① 타입 분류 →
   ② 그 타입 전용 스키마(해당 필드만·전부 required)로 치수 추출, 2단계로 나눈다.
   reconstruct PARAMS 와 동일한 필드 집합. AI=이해, 형상·게이트는 결정론. */
const TYPE_FIELDS = {
  plate_with_holes: ['width', 'depth', 'thickness'],
  stepped_plate: ['width', 'depth', 'thickness', 'stepWidth', 'stepThickness'],
  l_bracket: ['legA', 'legB', 'width', 'thickness'],
  flange: ['outerDia', 'boreDia', 'thickness', 'bcd', 'boltHoleD', 'boltCount'],
  bent_sheet: ['webWidth', 'flangeHeight', 'length', 'thickness'],
  tube: ['outerDia', 'innerDia', 'length'],
  rect_tube: ['width', 'height', 'wallThk', 'length'],
  box: ['width', 'depth', 'height'],
  cylinder: ['diameter', 'length'],
  gusset: ['legA', 'legB', 'thickness'],
  base_plate: ['width', 'depth', 'thickness', 'boltDia'],
  // #3 어휘확장 — 도면 표기(주석) 기반 추출: 기어=m·z 표, 볼트=M호칭, 벽=개구 치수
  spur_gear: ['module', 'teeth', 'thickness', 'boreDia'],
  hex_bolt: ['threadDia', 'length'],
  wall_with_openings: ['length', 'thickness', 'height'],
  slab_with_openings: ['length', 'depth', 'thickness'],
  tapered_girder: ['length', 'webH1', 'webH2', 'webT', 'topW', 'topT', 'botW', 'botT'],
};
const FIELD_HELP = {
  plate_with_holes: 'width(TOP 가로), depth(TOP 세로), thickness(두께). 원형 구멍은 holes[{x,y,d}] — TOP VIEW 좌하단 원점(0,0), "(nEA)"=동일 지름 개수',
  stepped_plate: 'width, depth, thickness(최대 두께), stepWidth(단차 구간 가로), stepThickness(단차 구간 두께)',
  l_bracket: 'legA(수평 다리 길이), legB(수직 다리 높이), width(부재 폭=TOP 세로), thickness',
  flange: 'outerDia(외경), boreDia(중앙 구멍 지름), thickness, bcd(볼트서클 지름 B.C.D.), boltHoleD(볼트구멍 지름), boltCount(볼트구멍 개수 — 정수)',
  bent_sheet: 'webWidth(웨브 폭), flangeHeight(플랜지 높이), length(부재 길이), thickness(판 두께)',
  tube: 'outerDia(외경 ⌀), innerDia(내경 ⌀), length(길이)',
  rect_tube: 'width, height(사각 단면 가로·세로), wallThk(벽두께), length(길이)',
  box: 'width, depth, height (속찬 직육면체 블록)',
  cylinder: 'diameter(지름 ⌀), length(길이) — 속찬 봉',
  gusset: 'legA, legB(두 직각변), thickness(판 두께)',
  base_plate: 'width, depth, thickness, boltDia(네 모서리 볼트홀 지름)',
  spur_gear: 'module(모듈 m — 요목표), teeth(잇수 z — 요목표, 정수), thickness(치폭), boreDia(축 구멍 지름, 없으면 0). 외경 표기만 있으면 m=OD/(z+2)',
  hex_bolt: 'threadDia(나사 호칭 M 뒤 숫자, 예 M12→12), length(자루 길이 — 머리 제외)',
  wall_with_openings: 'length(벽 길이), thickness(벽 두께), height(벽 높이). 개구부는 openings[{x,w,h,sill}] — 문 sill=0, 창 sill>0',
  slab_with_openings: 'length(X), depth(Y), thickness(슬래브 두께). 관통 개구는 openings[{x,y,w,d}] — 계단·승강로·덕트 관통(두께 전체 관통)',
  tapered_girder: 'length(스팬), webH1·webH2(양 끝 웹 춤 — 다르면 변단면), webT(웹 두께), topW/topT·botW/botT(상·하 플랜지 폭·두께). 입면도에서 끝과 중앙의 춤이 다르면 이 어휘',
};
const CLASSIFY_LIST = `plate_with_holes(타공 평판) / stepped_plate(단차 평판) / l_bracket(L 브래킷) / flange(원형 플랜지+볼트서클) / bent_sheet(U채널 절곡판) / tube(원형 파이프·중공) / rect_tube(각관·사각중공) / box(속찬 직육면체 블록) / cylinder(속찬 원기둥 봉) / gusset(직각삼각 거셋 보강판) / base_plate(모서리 볼트홀 베이스판) / spur_gear(스퍼기어 — 치형 원·요목표 m·z) / hex_bolt(육각볼트 — M호칭·육각머리) / wall_with_openings(벽체 입면 — 문·창 개구)`;
const CLASSIFY_SCHEMA = {
  type: 'OBJECT',
  properties: { type: { type: 'STRING', enum: [...Object.keys(TYPE_FIELDS), 'unknown'] }, confidence: NUM },
  required: ['type', 'confidence'],
};

async function callGeminiImage(base64, mimeType, model, prompt, schema) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey()}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ inline_data: { mime_type: mimeType, data: base64 } }, { text: prompt }] }],
      // thinking 유지(비활성 시 degenerate float 발생 — 원 callGemini 주석 참조).
      generationConfig: { temperature: 0, response_mime_type: 'application/json', response_schema: schema, maxOutputTokens: 8192 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  const text = j.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('empty response: ' + JSON.stringify(j).slice(0, 200));
  return { text, usage: j.usageMetadata };
}
function parseWithRepair(text) {
  try { return JSON.parse(text); } catch { /* try repair */ }
  return JSON.parse(repairJsonNumbers(text)); // may throw — caller retries
}
function paramSchemaFor(type) {
  const props = { unit: { type: 'STRING' } };
  for (const f of TYPE_FIELDS[type]) props[f] = NUM;
  if (type === 'plate_with_holes') props.holes = { type: 'ARRAY', items: { type: 'OBJECT', properties: { x: NUM, y: NUM, d: NUM }, required: ['x', 'y', 'd'] } };
  return { type: 'OBJECT', properties: props, required: TYPE_FIELDS[type] };
}

/**
 * 웹 업로드용 — base64 + mimeType 를 받아 two-stage(분류→치수) 로 11종 어휘를 추출.
 * 각 단계 3중 복구(repair→retry). 지원 mime: png/jpeg/webp. AI 는 이해만, 검증은 결정론.
 */
export async function extractDrawingFromImage(base64, mimeType = 'image/png', { model = 'gemini-2.5-flash' } = {}) {
  // ① 타입 분류
  const clsPrompt = `기계 제작 도면(정투상, mm)의 부품 유형을 분류하라. 후보:\n${CLASSIFY_LIST}\n판별 불가 시 unknown. 형식: {"type":"...","confidence":0~1} JSON 하나만.`;
  let cls = null, lastErr;
  for (let a = 0; a < EXTRACT_MAX_ATTEMPTS; a++) {
    try { const { text } = await callGeminiImage(base64, mimeType, model, clsPrompt, CLASSIFY_SCHEMA); const o = parseWithRepair(text); if (o && o.type) { cls = o; break; } }
    catch (e) { lastErr = e; }
  }
  if (!cls) throw lastErr ?? new Error('classify failed');
  const type = String(cls.type || 'unknown');
  const confidence = typeof cls.confidence === 'number' ? cls.confidence : 0;
  if (type === 'unknown' || !TYPE_FIELDS[type]) return { intent: { type: 'unknown', confidence }, model };

  // ② 타입 전용 스키마로 치수 추출(해당 필드만·전부 required)
  const exPrompt = `이 도면은 '${type}' 부품이다. 아래 치수 필드를 도면의 치수선·주석에서 읽어 모두 채워라(하나도 비우지 말 것; 인쇄된 치수 우선, 없으면 축척·대칭으로 추정). 무관한 필드는 만들지 마라.\n필드: ${FIELD_HELP[type]}\n형식: JSON 하나만.`;
  /**
   * ★260802 — **결측 응답을 성공으로 보고 있었다.**
   *
   * 재시도 루프가 **던진 예외만** 잡고, 스키마상 `required` 인 필드가 **빈 채로 온 응답**은
   * 그대로 `break` 했다. 실측(`flange-04-scan` 4회 반복):
   * ```
   * run0: 결측 boreDia,bcd,boltHoleD,boltCount   ← 4개가 **동시에** 빈다
   * run1~3: 결측 없음
   * ```
   * 하나씩 못 읽는 게 아니라 **2단계가 통째로 부실하게 끝나는 회차**가 25% 있었고,
   * 그 회차가 그대로 채점돼 파라미터 정확도를 끌어내렸다.
   *
   * ⚠ **비운 값을 우리가 채우지 않는다.** 추정으로 메우면 틀린 치수로 3D 가 만들어진다 —
   *   대신 **같은 요청을 다시** 한다. 4회 중 3회가 성공이므로 재시도 1회로 결측률이
   *   25% → 약 6% 로 떨어진다(비용은 실패 회차에만 붙는다).
   * ⚠ 끝까지 결측이면 **결측인 채로** 내보낸다. 게이트가 잡고 사용자가 되묻는 것이,
   *   지어낸 값으로 통과하는 것보다 낫다.
   */
  const need = TYPE_FIELDS[type] ?? [];
  const missingOf = (p) => (p ? need.filter((k) => p[k] == null || Number.isNaN(Number(p[k]))) : need);
  let params = null;
  let lastMissing = need;
  for (let a = 0; a < EXTRACT_MAX_ATTEMPTS; a++) {
    try {
      const { text } = await callGeminiImage(base64, mimeType, model, exPrompt, paramSchemaFor(type));
      const got = parseWithRepair(text);
      const miss = missingOf(got);
      // 결측이 더 적은 응답을 남긴다 — 마지막 응답이 항상 나은 것은 아니다.
      if (!params || miss.length < lastMissing.length) { params = got; lastMissing = miss; }
      if (!miss.length) break;
    } catch (e) { lastErr = e; }
  }
  if (!params) throw lastErr ?? new Error('extract failed');
  if (type === 'flange' && typeof params.boltCount === 'number') params.boltCount = Math.round(params.boltCount);
  const intent = { type, confidence, ...params };
  /**
   * ⚠ 재시도 후에도 남은 결측은 **이름으로 남긴다.** 없으면 사용자는 게이트 오류만 보고
   *   「왜 실패했는지」를 모른다 — 판독을 못 한 것과 형상이 틀린 것은 다른 문제다.
   *   그리고 신뢰도를 강등한다: 못 읽은 값이 있는 판독을 confidence 1 로 두면 과고지다.
   */
  if (lastMissing.length) {
    intent.missingFields = lastMissing;
    intent.confidence = Math.min(confidence, 0.4);
    intent.missingNote = `도면에서 ${lastMissing.join('·')} 를 읽지 못했다(재시도 후에도). `
      + '값을 추정해 채우지 않았다 — 그 치수를 알려 주거나 해당 부분이 보이는 도면을 주세요.';
  }

  // D1 역투영 diff(260719, 도면 경로만): 추출 실루엣을 원본 잉크에 되그려 지지율·스케일
  // 잔차 검사 — 낮으면 신뢰도 강등 + 되묻기. 로더 불가 환경이면 생략(정직 — 강등 없음).
  let reproject;
  try {
    const { reprojectDiff, loadGrayPng } = await import('./reproject-diff.mjs');
    const gray = await loadGrayPng(Buffer.from(base64, 'base64'));
    reproject = reprojectDiff(gray, intent);
    if (reproject.verdict === 'DEMOTE' || reproject.verdict === 'NO_VIEW') {
      intent.confidence = +(confidence * reproject.confidenceFactor).toFixed(3);
    }
  } catch (e) { reproject = { verdict: 'SKIPPED', reasons: [String(e?.message ?? e).slice(0, 80)] }; }
  return { intent, model, reproject };
}

const isMain = process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('extract.mjs');
if (isMain && process.argv[2]) {
  const { intent, usage, model } = await extractDrawing(process.argv[2]);
  console.log(JSON.stringify(intent, null, 1));
  console.log('--- model:', model, 'tokens:', usage?.totalTokenCount);
}
