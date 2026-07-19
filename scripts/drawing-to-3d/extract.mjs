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

async function callGemini(img, model, mimeType = 'image/png') {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey()}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ inline_data: { mime_type: mimeType, data: img } }, { text: PROMPT }] }],
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
  //   (b) retry the API call (up to 3 attempts);
  //   (c) if all fail, the caller (run-e2e) records ERR truthfully — never mask.
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { text, usage } = await callGemini(img, model);
    try {
      return { intent: JSON.parse(text), usage, model, repaired: false };
    } catch {
      try {
        const fixed = repairJsonNumbers(text);
        if (fixed !== text) return { intent: JSON.parse(fixed), usage, model, repaired: true };
      } catch { /* repair didn't help — fall through to retry */ }
      lastErr = new Error('bad extraction JSON (unrepairable)');
    }
  }
  throw lastErr;
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
  for (let a = 0; a < 3; a++) {
    try { const { text } = await callGeminiImage(base64, mimeType, model, clsPrompt, CLASSIFY_SCHEMA); const o = parseWithRepair(text); if (o && o.type) { cls = o; break; } }
    catch (e) { lastErr = e; }
  }
  if (!cls) throw lastErr ?? new Error('classify failed');
  const type = String(cls.type || 'unknown');
  const confidence = typeof cls.confidence === 'number' ? cls.confidence : 0;
  if (type === 'unknown' || !TYPE_FIELDS[type]) return { intent: { type: 'unknown', confidence }, model };

  // ② 타입 전용 스키마로 치수 추출(해당 필드만·전부 required)
  const exPrompt = `이 도면은 '${type}' 부품이다. 아래 치수 필드를 도면의 치수선·주석에서 읽어 모두 채워라(하나도 비우지 말 것; 인쇄된 치수 우선, 없으면 축척·대칭으로 추정). 무관한 필드는 만들지 마라.\n필드: ${FIELD_HELP[type]}\n형식: JSON 하나만.`;
  let params = null;
  for (let a = 0; a < 3; a++) {
    try { const { text } = await callGeminiImage(base64, mimeType, model, exPrompt, paramSchemaFor(type)); params = parseWithRepair(text); break; }
    catch (e) { lastErr = e; }
  }
  if (!params) throw lastErr ?? new Error('extract failed');
  if (type === 'flange' && typeof params.boltCount === 'number') params.boltCount = Math.round(params.boltCount);
  const intent = { type, confidence, ...params };

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
