/**
 * 2D→3D — Gemini Vision 도면 추출기 v2 (어휘 5종, ② 도면 이해 층).
 * 도면 PNG → 구조화 intent JSON (responseSchema 강제, temperature 0).
 * 원칙: AI는 "이해"만 담당 — 형상 생성·검증은 결정론 층(reconstruct/verify).
 * usage: node extract.mjs testdata/flange-04.png
 */
import { readFileSync } from 'node:fs';

export function apiKey() {
  const env = readFileSync('C:/Users/gomd9/Downloads/nexysys_1/.env', 'utf8');
  const m = env.match(/^GEMINI_API_KEY=(\S+)/m);
  if (!m) throw new Error('GEMINI_API_KEY not found');
  return m[1];
}

const NUM = { type: 'NUMBER' };
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

async function callGemini(img, model) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey()}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ inline_data: { mime_type: 'image/png', data: img } }, { text: PROMPT }] }],
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
  return text.replace(/(-?\d+(?:\.\d+)?)[eE][+-]?\d{4,}/g, '$1');
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

const isMain = process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('extract.mjs');
if (isMain && process.argv[2]) {
  const { intent, usage, model } = await extractDrawing(process.argv[2]);
  console.log(JSON.stringify(intent, null, 1));
  console.log('--- model:', model, 'tokens:', usage?.totalTokenCount);
}
