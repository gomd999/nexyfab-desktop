/**
 * 2D→3D 대화형 편집 — 자연어 지시로 도면(추출 intent)을 수정한다.
 *
 * 원칙(방법론 §1.3 그대로): AI는 "구조화된 패치"만 제안하고, 형상 변경은
 * 결정론 코드가 적용·검증한다. AI가 좌표·치수를 직접 만들어 형상에 쓰는 경로는
 * 없다 — 패치는 알려진 필드만 건드리고, 게이트가 결과를 검증한다.
 *
 *   현재 추출 JSON + "구멍을 8→12로 키우고 (50,50)에 하나 추가해줘"
 *     → Gemini: EditPatch (setParams / holes.add / holes.removeNearest / setHoleDiameter)
 *     → applyPatch (결정론, 클램프·미지필드 무시)
 *     → toComponentIntent + gate (검증)
 *     → 통과분만 새 도면으로 채택
 *
 * usage: node edit.mjs '<extraction.json>' "지시문"
 */
import { readFileSync } from 'node:fs';
import { apiKey } from './extract.mjs';
import { toComponentIntent } from './to-intent.mjs';
import { gate } from './reconstruct.mjs';

const NUM = { type: 'NUMBER' };
const PATCH_SCHEMA = {
  type: 'OBJECT',
  properties: {
    // 파라미터 덮어쓰기 — 지시에 언급된 필드만 채운다(부분 갱신).
    setParams: {
      type: 'OBJECT',
      properties: {
        width: NUM, depth: NUM, thickness: NUM,
        stepWidth: NUM, stepThickness: NUM, legA: NUM, legB: NUM,
        outerDia: NUM, innerDia: NUM, boreDia: NUM, bcd: NUM, boltHoleD: NUM, boltCount: NUM,
        webWidth: NUM, flangeHeight: NUM, length: NUM, height: NUM, wallThk: NUM,
      },
    },
    holes: {
      type: 'OBJECT',
      properties: {
        add: { type: 'ARRAY', items: { type: 'OBJECT', properties: { x: NUM, y: NUM, d: NUM }, required: ['x', 'y', 'd'] } },
        removeNearest: { type: 'ARRAY', items: { type: 'OBJECT', properties: { x: NUM, y: NUM }, required: ['x', 'y'] } },
        setDiameterAll: NUM,
      },
    },
    note: { type: 'STRING' }, // 모델이 무엇을 바꿨는지 한 줄
  },
};

const PATCH_PROMPT = (extraction, instruction) => `현재 부품(파라메트릭 도면 JSON):
${JSON.stringify(extraction)}

사용자 지시: "${instruction}"

이 지시를 반영하는 편집 패치만 출력하라. 규칙:
- 지시에 언급된 항목만 바꿔라. 언급 없는 필드는 패치에 넣지 마라.
- 치수 변경은 setParams에, 구멍 추가/삭제/일괄지름은 holes에.
- 구멍 삭제는 removeNearest에 그 구멍의 대략 좌표를 넣어라(가장 가까운 구멍이 삭제됨).
- 좌표/치수는 mm. 값을 지어내지 말고 지시에서 계산 가능한 값만 사용하라.`;

/** Gemini로 EditPatch 생성 (AI는 여기까지만 — 이해/계획). */
export async function buildPatch(extraction, instruction, { model = 'gemini-2.5-flash' } = {}) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey()}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: PATCH_PROMPT(extraction, instruction) }] }],
      generationConfig: { temperature: 0, response_mime_type: 'application/json', response_schema: PATCH_SCHEMA, maxOutputTokens: 2048 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const j = await res.json();
  const text = j.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('empty patch response');
  return JSON.parse(text);
}

const KNOWN_PARAMS = new Set([
  'width', 'depth', 'thickness', 'stepWidth', 'stepThickness', 'legA', 'legB',
  'outerDia', 'innerDia', 'boreDia', 'bcd', 'boltHoleD', 'boltCount', 'webWidth',
  'flangeHeight', 'length', 'height', 'wallThk',
]);

/**
 * 패치를 결정론적으로 적용한다 (순수 함수, Gemini 불필요 — 테스트 대상).
 * - setParams: 알려진 숫자 필드만, 유한·양수만 수용
 * - holes.setDiameterAll → add → removeNearest 순서로 적용
 * - 미지 필드/비정상 값은 조용히 무시 (AI가 헛것을 넣어도 형상에 안 샌다)
 */
export function applyPatch(extraction, patch) {
  const out = structuredClone(extraction);
  const changes = [];
  const ok = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

  for (const [k, v] of Object.entries(patch?.setParams ?? {})) {
    if (KNOWN_PARAMS.has(k) && ok(v)) {
      if (out[k] !== v) changes.push(`${k}: ${out[k]} → ${v}`);
      out[k] = k === 'boltCount' ? Math.round(v) : v;
    }
  }

  const h = patch?.holes;
  if (h && Array.isArray(out.holes)) {
    if (ok(h.setDiameterAll)) {
      out.holes = out.holes.map((hole) => ({ ...hole, d: h.setDiameterAll }));
      changes.push(`all hole d → ${h.setDiameterAll}`);
    }
    for (const nh of h.add ?? []) {
      if (ok(nh.d) && Number.isFinite(nh.x) && Number.isFinite(nh.y)) {
        out.holes.push({ x: nh.x, y: nh.y, d: nh.d });
        changes.push(`+hole (${nh.x},${nh.y}) ⌀${nh.d}`);
      }
    }
    for (const rm of h.removeNearest ?? []) {
      if (!Number.isFinite(rm.x) || !Number.isFinite(rm.y) || out.holes.length === 0) continue;
      let bi = -1, bd = Infinity;
      out.holes.forEach((hole, i) => { const dd = Math.hypot(hole.x - rm.x, hole.y - rm.y); if (dd < bd) { bd = dd; bi = i; } });
      const [g] = out.holes.splice(bi, 1);
      changes.push(`-hole (${g.x},${g.y})`);
    }
  }
  return { extraction: out, changes };
}

/**
 * 대화형 편집 1스텝: 지시 → 패치 → 결정론 적용 → 게이트 검증.
 * 게이트 실패 시 원본을 유지하고 실패 사유를 반환(잘못된 편집이 형상을 깨지 않음).
 */
export async function editDrawing(extraction, instruction, opts = {}) {
  const patch = await buildPatch(extraction, instruction, opts);
  const { extraction: edited, changes } = applyPatch(extraction, patch);
  // gate() validates the FLAT extraction (range / plate-ness / hole-inscribed).
  let gateErrs = [];
  try {
    gateErrs = gate(edited);
  } catch (e) {
    gateErrs = [e.message];
  }
  const accepted = gateErrs.length === 0;
  const accEx = accepted ? edited : extraction; // 실패 시 롤백
  return {
    accepted,
    extraction: accEx,
    intent: accepted ? toComponentIntent(accEx) : null, // 통과분만 3D intent로
    changes,
    gateErrors: gateErrs,
    note: patch?.note,
  };
}

const isMain = process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('edit.mjs');
if (isMain && process.argv[3]) {
  const extraction = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const r = await editDrawing(extraction, process.argv[3]);
  console.log(JSON.stringify(r, null, 1));
}
