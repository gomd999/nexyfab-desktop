/**
 * 2D→3D v1 — Gemini Vision 도면 추출기 (② 도면 이해 층).
 * 도면 PNG → 구조화 intent JSON (responseSchema 강제).
 * 원칙: AI는 "이해"만 담당 — 형상 생성·검증은 결정론 층(reconstruct/verify).
 * usage: node extract.mjs testdata/plate-01.png
 */
import { readFileSync } from 'node:fs';

export function apiKey() {
  const env = readFileSync('C:/Users/gomd9/Downloads/nexysys_1/.env', 'utf8');
  const m = env.match(/^GEMINI_API_KEY=(\S+)/m);
  if (!m) throw new Error('GEMINI_API_KEY not found');
  return m[1];
}

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    type: { type: 'STRING', enum: ['plate_with_holes', 'unknown'] },
    unit: { type: 'STRING' },
    width: { type: 'NUMBER', description: 'TOP VIEW 가로 치수 (mm)' },
    depth: { type: 'NUMBER', description: 'TOP VIEW 세로 치수 (mm)' },
    thickness: { type: 'NUMBER', description: 'FRONT/SIDE VIEW 두께 치수 (mm)' },
    holes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          x: { type: 'NUMBER', description: '구멍 중심 x — TOP VIEW 좌하단 원점, 오른쪽 +' },
          y: { type: 'NUMBER', description: '구멍 중심 y — TOP VIEW 좌하단 원점, 위쪽 +' },
          d: { type: 'NUMBER', description: '구멍 지름 mm' },
        },
        required: ['x', 'y', 'd'],
      },
    },
    confidence: { type: 'NUMBER', description: '0~1' },
  },
  required: ['type', 'width', 'depth', 'thickness', 'holes', 'confidence'],
};

const PROMPT = `기계 제작 도면(3각법 정투상)을 판독해 파라메트릭 모델 JSON으로 추출하라.
규칙:
- 치수선에 인쇄된 숫자를 그대로 읽어라 (픽셀 측정으로 추정하지 말 것 — 단, 치수가 없는 항목은 인쇄된 치수와 도면 축척을 이용해 계산).
- TOP VIEW의 좌표계: 사각형 좌하단 모서리가 원점(0,0), 오른쪽 +x, 위쪽 +y.
- 구멍(⌀ 기호, 십자 중심선 원)은 모두 나열하라. 위치 치수가 1개 구멍에만 있으면, 나머지는 대칭 배치와 축척으로 계산하라.
- "(nEA)"는 동일 지름 구멍 개수를 뜻한다.
- 판독 불가능하면 type='unknown'으로.`;

export async function extractDrawing(pngPath, { model = 'gemini-2.5-flash' } = {}) {
  const img = readFileSync(pngPath).toString('base64');
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey()}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ inline_data: { mime_type: 'image/png', data: img } }, { text: PROMPT }] }],
      generationConfig: {
        temperature: 0,
        response_mime_type: 'application/json',
        response_schema: RESPONSE_SCHEMA,
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini ${res.status}: ${body.slice(0, 200)}`);
  }
  const j = await res.json();
  const text = j.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('empty response: ' + JSON.stringify(j).slice(0, 200));
  return { intent: JSON.parse(text), usage: j.usageMetadata, model };
}

// CLI
if (process.argv[2]) {
  const { intent, usage, model } = await extractDrawing(process.argv[2]);
  console.log(JSON.stringify(intent, null, 1));
  console.log('--- model:', model, 'tokens:', usage?.totalTokenCount);
}
