/**
 * 2D→3D 입구 B — 자연어 텍스트 → 파라메트릭 도면 intent (이미지 없이 시작).
 *
 * 방법론의 입구 B: "텍스트 → 치수 도면 체크포인트 → 3D". 여기서 나온 intent가
 * 곧 사용자가 검토·수정(edit_drawing)하는 치수 도면 체크포인트이며, 그대로
 * reconstruct_3d로 3D가 된다. 입구 A(도면 이미지)와 동일한 스키마·게이트·재구성을
 * 공유하고, 입력만 이미지→텍스트로 다르다.
 *
 * 원칙 유지: AI는 "설명→구조화 intent"까지만. 형상·검증은 결정론(reconstruct/gate).
 * 텍스트는 이미지보다 더 부족 결정 → 치수 미기입 시 기본값을 쓰되 confidence를 낮춰
 * "가설(계획서)"임을 표시한다(입구 A=오라클, 입구 B=계획서).
 *
 * usage: node from-text.mjs "가로 200 세로 100 두께 10 판, 네 귀퉁이에 지름 8 구멍"
 */
import { apiKey, RESPONSE_SCHEMA, repairJsonNumbers } from './extract.mjs';

// 프롬프트는 간결하게 — gemini-2.5-flash는 긴 프롬프트에서 구조화 출력이
// 깨지기 쉽다(malformed JSON). 5타입 필드 매핑만 주고 나머지는 스키마가 강제.
const PROMPT = (desc) => `자연어 부품 설명을 파라메트릭 JSON으로. 명시 치수는 그대로(mm), 미기입은 통상값, 추정 많을수록 confidence↓.
plate_with_holes: width,depth,thickness,holes[{x,y,d}] (좌하단 원점, 대칭구멍은 좌표계산)
stepped_plate: width,depth,thickness,stepWidth,stepThickness
l_bracket: legA,legB,width,thickness
flange: outerDia,boreDia,thickness,bcd,boltHoleD,boltCount
bent_sheet: webWidth,flangeHeight,length,thickness
설명: "${desc}"`;

export async function textToIntent(description, { model = 'gemini-2.5-flash' } = {}) {
  const body = JSON.stringify({
    contents: [{ parts: [{ text: PROMPT(description) }] }],
    generationConfig: {
      temperature: 0, response_mime_type: 'application/json',
      response_schema: RESPONSE_SCHEMA,
      // 8192 (not 2048): thinking is enabled and consumes the output budget on
      // the long 5-type prompt — a tight cap truncated bent_sheet JSON mid-object.
      maxOutputTokens: 8192,
    },
  });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey()}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body,
    });
    if (!res.ok) {
      // 503(과부하)/429(rate)는 일시적 — 지수 백오프로 재시도. 그 외는 즉시 실패.
      if ((res.status === 503 || res.status === 429) && attempt < 3) {
        await sleep(1500 * (attempt + 1));
        continue;
      }
      throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 160)}`);
    }
    const j = await res.json();
    const text = j.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) { lastErr = new Error('empty response'); continue; }
    try {
      return { intent: JSON.parse(text), usage: j.usageMetadata, model, source: 'text', repaired: false };
    } catch {
      try {
        const fixed = repairJsonNumbers(text);
        if (fixed !== text) return { intent: JSON.parse(fixed), usage: j.usageMetadata, model, source: 'text', repaired: true };
      } catch { /* fall through */ }
      lastErr = new Error('bad JSON from text (unrepairable)');
    }
  }
  throw lastErr;
}

// ─── Piece 2: 텍스트 → 복합 어셈블리 계획 ────────────────────────────────────

const NUM = { type: 'NUMBER' };
const PART_PARAMS = {
  type: 'OBJECT',
  properties: {
    width: NUM, depth: NUM, thickness: NUM, stepWidth: NUM, stepThickness: NUM,
    legA: NUM, legB: NUM, outerDia: NUM, boreDia: NUM, bcd: NUM, boltHoleD: NUM, boltCount: NUM,
    webWidth: NUM, flangeHeight: NUM, length: NUM,
    holes: { type: 'ARRAY', items: { type: 'OBJECT', properties: { x: NUM, y: NUM, d: NUM }, required: ['x', 'y', 'd'] } },
  },
};
const ASSEMBLY_SCHEMA = {
  type: 'OBJECT', required: ['name', 'parts'],
  properties: {
    name: { type: 'STRING' },
    parts: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT', required: ['id', 'type', 'params'],
        properties: {
          id: { type: 'STRING' },
          type: { type: 'STRING', enum: ['plate_with_holes', 'stepped_plate', 'l_bracket', 'flange', 'bent_sheet'] },
          params: PART_PARAMS,
          at: { type: 'OBJECT', properties: { tx: NUM, ty: NUM, tz: NUM, rx: NUM, ry: NUM, rz: NUM } },
        },
      },
    },
  },
};

const ASM_PROMPT = (desc) => `자연어 제품 설명을 복합 어셈블리 계획(JSON)으로 변환하라.

각 부품은 어휘 5종 중 하나: plate_with_holes / stepped_plate / l_bracket / flange / bent_sheet.
부품별로 type + params(해당 유형 치수) + at(배치: tx,ty,tz 평행이동 mm, rx,ry,rz 회전 deg).

좌표계: 전역 원점(0,0,0). 각 부품의 로컬 원점이 at.translate 위치에 놓인다.
- 판재는 로컬 좌하단이 원점, z=0이 바닥. 다른 부품을 판 위에 얹으려면 tz=판두께.
- 겹치지 않게(접촉만) 배치하라. 볼트체결·용접 접촉은 허용, 부피 침투는 피하라.
- 치수 미기입은 통상값. 값을 지어낸 정도만큼 각 부품 신뢰가 낮음을 감안.

설명: "${desc}"`;

export async function textToAssembly(description, { model = 'gemini-2.5-flash' } = {}) {
  const body = JSON.stringify({
    contents: [{ parts: [{ text: ASM_PROMPT(description) }] }],
    generationConfig: { temperature: 0, response_mime_type: 'application/json', response_schema: ASSEMBLY_SCHEMA, maxOutputTokens: 8192 },
  });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey()}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body,
    });
    if (!res.ok) {
      if ((res.status === 503 || res.status === 429) && attempt < 3) { await sleep(1500 * (attempt + 1)); continue; }
      throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 160)}`);
    }
    const j = await res.json();
    const text = j.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) { lastErr = new Error('empty response'); continue; }
    try { return { assembly: JSON.parse(text), usage: j.usageMetadata, model }; }
    catch {
      try { const fixed = repairJsonNumbers(text); if (fixed !== text) return { assembly: JSON.parse(fixed), usage: j.usageMetadata, model }; }
      catch { /* fall through */ }
      lastErr = new Error('bad assembly JSON (unrepairable)');
    }
  }
  throw lastErr;
}

const isMain = process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('from-text.mjs');
if (isMain && process.argv[2]) {
  const { intent, model, usage } = await textToIntent(process.argv[2]);
  console.log(JSON.stringify(intent, null, 1));
  console.log('--- model:', model, 'tokens:', usage?.totalTokenCount, '| confidence:', intent.confidence);
}
