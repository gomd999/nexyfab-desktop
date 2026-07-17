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
import { apiKey, repairJsonNumbers } from './extract.mjs';
import { CLASSIFY_SCHEMA, TYPE_SCHEMAS, TYPE_HINTS, ALL_TYPES } from './schemas.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 텍스트 프롬프트 → 구조화 JSON, 신뢰성 3중 방어:
 *   1) 모델 폴백: gemini-2.5-flash(빠름) → 실패 시 gemini-2.5-pro(폭주 거의 없음).
 *      flash가 텍스트 bent_sheet에서 degenerate-number 폭주로 MAX_TOKENS에 걸리는
 *      실패를 pro가 안정적으로 처리.
 *   2) 503/429 지수 백오프.
 *   3) JSON 리페어(폭주 지수·긴소수) 후 재파싱.
 * @returns { data, model, repaired }
 */
export async function callGeminiJson(promptText, schema, { models = ['gemini-2.5-flash', 'gemini-2.5-pro'], maxOutputTokens = 8192, thinkingBudget } = {}) {
  // schema=null → response_schema 생략(free-form JSON). 플랫/유니온 스키마가 구조화
  // 출력에서 토큰을 폭주시켜 MAX_TOKENS 절단되는 경우 우회용(강한 프롬프트로 형식 지시).
  // thinkingBudget=0 → gemini-2.5 "thinking" 비활성(출력토큰을 사고에 소진하는 MAX_TOKENS 방지).
  const generationConfig = { temperature: 0, response_mime_type: 'application/json', maxOutputTokens };
  if (schema) generationConfig.response_schema = schema;
  if (thinkingBudget !== undefined) generationConfig.thinkingConfig = { thinkingBudget };
  const body = JSON.stringify({
    contents: [{ parts: [{ text: promptText }] }],
    generationConfig,
  });
  let lastErr;
  for (const model of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      let res;
      try {
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey()}`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body,
        });
      } catch (e) { lastErr = e; await sleep(1000); continue; }
      if (!res.ok) {
        if (res.status === 503 || res.status === 429) { lastErr = new Error(`${model} ${res.status}`); await sleep(1500 * (attempt + 1)); continue; }
        lastErr = new Error(`${model} ${res.status}: ${(await res.text()).slice(0, 120)}`);
        break; // 비-일시적 에러 → 다음 모델로
      }
      const j = await res.json();
      const text = j.candidates?.[0]?.content?.parts?.[0]?.text;
      const finish = j.candidates?.[0]?.finishReason;
      if (!text) { lastErr = new Error(`${model} empty (${finish})`); continue; }
      try { return { data: JSON.parse(text), model, repaired: false }; }
      catch {
        try { const fixed = repairJsonNumbers(text); if (fixed !== text) return { data: JSON.parse(fixed), model, repaired: true }; }
        catch { /* fall through */ }
        lastErr = new Error(`${model} bad JSON (${finish})`);
        // MAX_TOKENS 폭주면 재시도 무의미 → 다음 모델로
        if (finish === 'MAX_TOKENS') break;
      }
    }
  }
  throw lastErr;
}

const TYPE_LIST = ALL_TYPES.map((t) => `${t}: ${TYPE_HINTS[t]}`).join('\n');

/**
 * 텍스트 → 도면 intent (2단계, 신뢰성 픽스):
 *   1) 분류 — 어떤 부품 유형인가 (작은 스키마)
 *   2) 추출 — 그 유형의 최소 스키마로만 치수 추출
 * union 스키마 폭주(MAX_TOKENS)를 원천 차단. AI는 이해까지만.
 */
export async function textToIntent(description, { models } = {}) {
  const opts = models ? { models } : {};
  // 1) 분류
  const clsPrompt = `다음 부품 설명이 어떤 유형인가? 하나만 고르라.\n${TYPE_LIST}\n설명: "${description}"`;
  const cls = await callGeminiJson(clsPrompt, CLASSIFY_SCHEMA, opts);
  const type = cls.data.type;
  if (type === 'unknown' || !TYPE_SCHEMAS[type]) {
    return { intent: { type: 'unknown', confidence: cls.data.confidence ?? 0 }, model: cls.model, source: 'text' };
  }
  // 2) 타입별 최소 스키마 추출
  const exPrompt = `부품 설명에서 ${type}의 치수를 추출하라. 필드: ${TYPE_HINTS[type]}.\n명시 치수는 그대로(mm), 미기입은 통상값(추정 많을수록 confidence↓).\n설명: "${description}"`;
  const ex = await callGeminiJson(exPrompt, TYPE_SCHEMAS[type], opts);
  return { intent: { type, ...ex.data }, model: ex.model, source: 'text', repaired: ex.repaired };
}

// ─── Piece 2: 텍스트 → 복합 어셈블리 계획 ────────────────────────────────────

const NUM = { type: 'NUMBER' };
const PART_PARAMS = {
  type: 'OBJECT',
  properties: {
    width: NUM, depth: NUM, thickness: NUM, stepWidth: NUM, stepThickness: NUM,
    legA: NUM, legB: NUM, outerDia: NUM, innerDia: NUM, boreDia: NUM, bcd: NUM, boltHoleD: NUM, boltCount: NUM,
    webWidth: NUM, flangeHeight: NUM, length: NUM, height: NUM, wallThk: NUM, diameter: NUM,
    holes: { type: 'ARRAY', items: { type: 'OBJECT', properties: { x: NUM, y: NUM, d: NUM }, required: ['x', 'y', 'd'] } },
  },
};
export const ASSEMBLY_SCHEMA = {
  type: 'OBJECT', required: ['name', 'parts'],
  properties: {
    name: { type: 'STRING' },
    parts: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT', required: ['id', 'type', 'params'],
        properties: {
          id: { type: 'STRING' },
          type: { type: 'STRING', enum: ['plate_with_holes', 'stepped_plate', 'l_bracket', 'flange', 'bent_sheet', 'tube', 'rect_tube', 'box', 'cylinder'] },
          params: PART_PARAMS,
          at: { type: 'OBJECT', properties: { tx: NUM, ty: NUM, tz: NUM, rx: NUM, ry: NUM, rz: NUM } },
          service: { type: 'STRING', enum: ['feed', 'hp', 'permeate', 'concentrate', 'motor', 'panel', 'frame', 'sludge'] },
        },
      },
    },
    // §D 토목 선형 개방 — AI는 선형 "선언"(IP·R·구조물·단면 파라미터)까지만.
    // 형상·측점·곡선·게이트·도면집은 결정론 템플릿(retaining_wall_alignment)이 수행.
    civilAlignment: {
      type: 'OBJECT',
      properties: {
        ips: { type: 'ARRAY', items: { type: 'ARRAY', items: NUM } },
        curves: { type: 'ARRAY', items: { type: 'OBJECT', required: ['ip', 'R'], properties: { ip: NUM, R: NUM } } },
        structures: { type: 'ARRAY', items: { type: 'OBJECT', required: ['sta', 'type'], properties: { sta: NUM, type: { type: 'STRING', enum: ['culvert', 'catch_basin', 'expansion_joint'] } } } },
        H: NUM, baseWidth: NUM, baseThickness: NUM, stemThickness: NUM, toeLength: NUM,
      },
    },
    // 배관 계획(#6) — AI는 "무엇을 무엇에 잇는가"(from/to 포트·계통)까지만.
    // 경로(waypoint)는 결정론 자동 라우터(autoRoutePipes)가 잡고 관통·교차 게이트로 검증한다.
    pipes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT', required: ['id', 'from', 'to'],
        properties: {
          id: { type: 'STRING' },
          from: { type: 'STRING' }, to: { type: 'STRING' },
          d: NUM,
          service: { type: 'STRING', enum: ['feed', 'hp', 'permeate', 'concentrate', 'sludge', 'supply', 'drain', 'vent'] },
        },
      },
    },
  },
};

const ASM_PROMPT = (desc) => `자연어 제품 설명을 복합 어셈블리 계획(JSON)으로 변환하라.

각 부품은 어휘 9종 중 하나: plate_with_holes / stepped_plate / l_bracket / flange / bent_sheet / tube(원형파이프:outerDia,innerDia,length) / rect_tube(각관:width,height,wallThk,length) / box(속찬 블록·함체:width,depth,height) / cylinder(원기둥 용기·베셀:diameter,length).
부품별로 type + params(해당 유형 치수) + at(배치: tx,ty,tz 평행이동 mm, rx,ry,rz 회전 deg) + service(계통: feed/hp/permeate/concentrate/motor/panel/frame/sludge — 해당 시만).

좌표계: 전역 원점(0,0,0). 각 부품의 로컬 원점이 at.translate 위치에 놓인다.
- 판재는 로컬 좌하단이 원점, z=0이 바닥. 다른 부품을 판 위에 얹으려면 tz=판두께.
- 겹치지 않게(접촉만) 배치하라. 볼트체결·용접 접촉은 허용, 부피 침투는 피하라.
- 치수 미기입은 통상값. 값을 지어낸 정도만큼 각 부품 신뢰가 낮음을 감안.

배관이 필요한 제품(펌프·탱크·스키드 등)이면 pipes[] 로 연결 계획만 선언하라:
- from/to = "부품id.면" (면: x+ x- y+ y- z+ z-), d = 관지름 mm(기본 26), service = 계통.
- 경로 좌표는 쓰지 마라 — 배관 경로는 결정론 라우터가 자동 생성·검증한다.

옹벽·도로변 벽 등 "선형(노선)" 설계 요청이면 parts 대신 civilAlignment 로 선언하라:
- ips=[[x,y],…] 평면 IP 좌표(mm) · curves=[{ip:내부 IP 인덱스, R:반경 mm}](곡선부만)
- structures=[{sta:측점 mm, type:'culvert'|'catch_basin'|'expansion_joint'}]
- H(벽고)·baseWidth·baseThickness·stemThickness·toeLength (mm, 미기입=통상값)
- 측점·곡선 기하·도면집·검증은 결정론 엔진이 수행 — 좌표 경로를 지어내지 마라.
- 게이트 거부 문구(예: "TL 합 X>구간장 Y — R 축소 또는 IP 이동")를 받으면 그에 맞춰 수정하라.

설명: "${desc}"`;

export async function textToAssembly(description, { models } = {}) {
  const { data, model } = await callGeminiJson(ASM_PROMPT(description), ASSEMBLY_SCHEMA, models ? { models } : {});
  return { assembly: data, model };
}

const isMain = process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('from-text.mjs');
if (isMain && process.argv[2]) {
  const { intent, model, usage } = await textToIntent(process.argv[2]);
  console.log(JSON.stringify(intent, null, 1));
  console.log('--- model:', model, 'tokens:', usage?.totalTokenCount, '| confidence:', intent.confidence);
}
