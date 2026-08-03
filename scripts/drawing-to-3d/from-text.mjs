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
import { CLASSIFY_SCHEMA, TYPE_SCHEMAS, TYPE_HINTS, ALL_TYPES } from './schemas.mjs';
import { PARAMS } from './reconstruct.mjs';
import { callAiJson as callAiJsonImpl, callGeminiJson as callGeminiJsonImpl } from './ai-json.mjs';

/** ```json 울타리·앞뒤 산문 제거 — 남겨진 소비처가 있을 수 있어 유지. */
export function stripFences(text) {
  const t = String(text).trim().replace(/^`{3}(?:json)?\s*/i, '').replace(/`{3}\s*$/, '');
  const i = t.indexOf('{'), j = t.lastIndexOf('}');
  return i >= 0 && j > i ? t.slice(i, j + 1) : t;
}

/**
 * 텍스트 프롬프트 → 구조화 JSON. 실제 호출·재시도·JSON 리페어 로직은
 * ai-json.mjs 로 단일화했다 — assemble 라우트·compose.mjs 가 같은 신뢰성
 * 전략(모델 폴백·429/5xx 백오프·JSON 리페어)을 쓴다.
 *
 * 기본 백엔드는 **Gemini**(260803 복원). `models` 에 `gpt-*` 를 넣으면 같은 함수가
 * OpenAI 로 나간다(260802 배선 유지) — 호출부는 모델 이름만 바꾸면 된다.
 * @returns { data, model, repaired }
 */
export async function callAiJson(promptText, schema, opts = {}) {
  return callAiJsonImpl(promptText, schema, opts);
}

/** Gemini 로 못 박아 호출한다(모델 이름과 무관). 260802 이전 호출부 호환용. */
export async function callGeminiJson(promptText, schema, opts = {}) {
  return callGeminiJsonImpl(promptText, schema, opts);
}

/**
 * 어휘 스펙 한 줄 — 힌트가 있으면 힌트, 없으면 **파라미터 이름**을 쓴다.
 *
 * ⚠ 260802 — 종전 `TYPE_LIST` 는 힌트를 그대로 박아, 힌트가 없는 **18종에
 *   `h_section: undefined` 를 LLM 에게 보내고 있었다.** 「설명이 없다」가 아니라
 *   **틀린 설명**을 준 것이고, 그 어휘는 사실상 고를 수 없었다.
 * ⚠ 설명을 지어내지 않는다 — 없으면 파라미터 이름만 준다. 그게 정직하고 더 쓸모 있다.
 */
const typeSpecLine = (t) => `${t}: ${TYPE_HINTS[t] ?? (PARAMS[t] ?? []).join(',')}`;
const TYPE_LIST = ALL_TYPES.map(typeSpecLine).join('\n');

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
  const cls = await callAiJson(clsPrompt, CLASSIFY_SCHEMA, opts);
  const type = cls.data.type;
  if (type === 'unknown' || !TYPE_SCHEMAS[type]) {
    return { intent: { type: 'unknown', confidence: cls.data.confidence ?? 0 }, model: cls.model, source: 'text' };
  }
  // 2) 타입별 최소 스키마 추출
  const exPrompt = `부품 설명에서 ${type}의 치수를 추출하라. 필드: ${TYPE_HINTS[type]}.\n명시 치수는 그대로(mm), 미기입은 통상값(추정 많을수록 confidence↓).\n설명: "${description}"`;
  const ex = await callAiJson(exPrompt, TYPE_SCHEMAS[type], opts);
  return { intent: { type, ...ex.data }, model: ex.model, source: 'text', repaired: ex.repaired };
}

// ─── Piece 2: 텍스트 → 복합 어셈블리 계획 ────────────────────────────────────

const NUM = { type: 'NUMBER' };
/**
 * 부품 파라미터 스키마 — **`PARAMS`(실제 어휘)에서 만든다.**
 *
 * ⚠ 260802 — 종전에는 키 19개가 손으로 박혀 있었다. 구조화 출력은 **스키마에 없는 키를
 *   조용히 떨군다.** 그래서 `h_section`(H,B,tw,tf)·`cone`(dia1,dia2)·`torus`(majorDia) 같은
 *   어휘를 LLM 이 올바르게 채워도 **값이 사라졌고**, 게이트에는
 *   `width invalid, depth invalid` 로 나타났다 — LLM 이 안 준 게 아니라 **우리가 버린** 것이다.
 *   실측 8건 중 7건이 이 형태였다.
 * ⚠ 어휘를 추가할 때마다 여기를 같이 고치는 구조였다. 그래서 갈렸다 —
 *   이 세션 내내 잡아 온 단일 소스 문제의 세 번째 판이다.
 */
/**
 * ⚠⚠ 260802 — **평면 유니온 스키마를 쓰지 않는다.** 한 번 시도했다가 되돌린 기록이다.
 *
 * 어휘 38종의 파라미터를 모두 합쳐 62키 평면 `OBJECT` 로 넓혔더니, 모델에게 **어느 키가
 * 이 타입의 것인지 신호가 사라졌다.** 실측(`box`, 카운터 2400×600×900):
 *
 *     받은 params : {"width":2400, "wireDia":600.0000000000001}
 *     필요 PARAMS : ["width","depth","height"]
 *
 * `wireDia` 는 **코일 스프링** 파라미터다. 키가 많을수록 좋아지는 게 아니라 **나빠졌다.**
 * 넓히기 전(19키)에는 흔한 타입의 키가 대부분이라 오히려 맞을 확률이 높았다.
 *
 * 그래서 파라미터는 **타입별 스키마(`TYPE_SCHEMAS`)로 따로 받는다** — 이 파일에 이미 있는
 * 2단계 경로(`textToIntent`: 분류 → 타입별 추출)와 같은 방식이다. 여기서는 골격만 받는다.
 */
const PART_PARAMS = {
  type: 'OBJECT',
  properties: {
    width: NUM, depth: NUM, thickness: NUM, height: NUM, length: NUM, diameter: NUM,
    outerDia: NUM, innerDia: NUM, wallThk: NUM, legA: NUM, legB: NUM,
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
          // ⚠ 260802 — enum 이 **9종 하드코딩**이었다. 프롬프트로 38종을 알려 줘도
          //   스키마가 9종만 허용하면 나머지는 애초에 고를 수 없다. `ALL_TYPES` 에서 만든다.
          type: { type: 'STRING', enum: [...ALL_TYPES] },
          params: PART_PARAMS,
          at: { type: 'OBJECT', properties: { tx: NUM, ty: NUM, tz: NUM, rx: NUM, ry: NUM, rz: NUM } },
          /**
           * ★260803 — **관계 배치.** `assembly-constraints.mjs` 의 리졸버는 이미 있고
           * `buildAssembly` 가 **실제로 호출**하는데(line 615), **스키마에 없어서 LLM 이
           * 선언할 방법이 없었다.** 그래서 모델은 `at` 절대좌표를 직접 계산할 수밖에 없었고,
           * 그것이 부유 28/42 의 근본 원인이다 — 엔진이 없는 게 아니라 **닿지 않았다.**
           * ⚠ 구조화 출력은 스키마에 없는 키를 조용히 떨군다 — 프롬프트로만 알려 주면 소용없다.
           */
          constraints: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT', required: ['type'],
              properties: {
                type: { type: 'STRING', enum: ['offset', 'concentric', 'onFace', 'mirror', 'centerline'] },
                to: { type: 'STRING' },
                face: { type: 'STRING', enum: ['top', 'bottom', 'left', 'right', 'front', 'back'] },
                axis: { type: 'STRING', enum: ['x', 'y', 'z'] },
                plane: { type: 'STRING', enum: ['xy', 'yz', 'zx'] },
                dx: NUM, dy: NUM, dz: NUM, gap: NUM, offset: NUM,
              },
            },
          },
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

/**
 * 프롬프트에 실을 **어휘 스펙** — `PARAMS`(실제 어휘)와 `TYPE_HINTS`(설명)에서 만든다.
 *
 * ⚠ 260802 — 종전에는 프롬프트에 **어휘 9종이 하드코딩**돼 있었다. 실제 어휘는 38종이다.
 *   실측: 8건 중 **4건이 게이트 거부**였고 사유가 `base_plate_1: depth invalid`,
 *   `top_plate: depth invalid` 처럼 **목록에 없는 type 을 지어낸** 것이었다.
 *   환각이 아니라 **우리가 알려 주지 않은 것**이다. 어휘를 늘릴 때마다 이 문장을 고치는
 *   구조였고, 그래서 어휘 38종과 프롬프트 9종이 갈렸다 — 이 세션 내내 잡아 온 단일 소스 문제다.
 *
 * ⚠ 힌트가 없는 어휘는 **파라미터 이름만** 싣는다. 설명을 지어내면 그것도 프롬프트에 실린다.
 */
/**
 * 게이트 오류를 **모델에게 되돌려** 한 번 고치게 한다 (260802).
 *
 * ## 왜 수리인가 — 동의어를 우리가 매핑하지 않는다
 * 실측: LLM 이 `wall_with_openings` 에 `height` 대신 **`width`** 를 줬다. 그런 동의어를
 * 우리가 표로 매핑하면 **사용자 의도를 추측**하는 것이 된다(`width` 가 정말 폭인 경우와
 * 구별할 수 없다). 대신 **게이트가 실제로 낸 오류 문구**를 그대로 주고 모델이 고치게 한다 —
 * 지어내는 쪽은 우리가 아니라 모델이고, 그 결과는 다시 게이트를 지난다.
 *
 * ## 규약
 * · `compose.mjs` 의 `composeWithGate` 와 **같은 형태**다(리포의 확립된 패턴 재사용).
 * · **최대 1회.** 무한 수리는 실패를 지연으로 바꾼다.
 * · 고치지 못하면 **고치지 못한 채로** 오류를 함께 돌려준다 — 조용히 통과시키지 않는다.
 */
async function repairAgainstGate(assembly, description, { models } = {}) {
  let errs = [];
  try {
    const { buildAssembly } = await import('./assembly.mjs');
    errs = buildAssembly(assembly)?.gateErrors ?? [];
    if (!errs.length) return { assembly, rounds: 0, errors: [], repairedIds: [] };
    /**
     * ★ 실패한 **부품만** 그 어휘의 `TYPE_SCHEMAS` 로 다시 받는다.
     *   어셈블리 스키마 하나로 전 어휘의 파라미터를 받으려 하면 키가 섞인다(위 주석 참조).
     *   타입별 스키마는 **그 타입의 키만** 있어 모델이 고를 여지가 없다.
     */
    const failedIds = new Set(errs.map((e) => String(e).split(':')[0]?.trim()).filter(Boolean));
    const parts = [...(assembly?.parts ?? [])];
    let changed = 0;
    const repairedIds = [];
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (!failedIds.has(String(p?.id))) continue;
      const schema = TYPE_SCHEMAS[p?.type];
      if (!schema) continue;   // 스키마가 없는 어휘는 건드리지 않는다(지어내지 않는다)
      const ask = `제품 설명에서 **${p.type}** 부품 "${p.id}" 의 치수를 뽑아라.
필드: ${typeSpecLine(p.type)}
⚠ 위 필드 이름만 쓴다. 동의어(width↔height 등)를 쓰면 거부된다. 미기입 치수는 통상값(mm).
설명: "${description}"
현재 값(불완전): ${JSON.stringify(p.params ?? {})}`;
      try {
        const { data: fixed } = await callAiJson(ask, schema, {
          ...(models ? { models } : {}), thinkingBudget: 0, maxOutputTokens: 2048,
        });
        // ★260803 — **누가 수리됐는지 기록한다.** 이 부품의 값은 「미기입은 통상값」 프롬프트로
        //   재추출된 것이라 원문 근거를 보장할 수 없다 → provenance 가 전량 `assumed` 로 내린다.
        if (fixed && typeof fixed === 'object') { parts[i] = { ...p, params: { ...p.params, ...fixed } }; changed += 1; repairedIds.push(String(p.id)); }
      } catch { /* 이 부품은 못 고쳤다 — 나머지는 계속 시도한다 */ }
    }
    if (!changed) return { assembly, rounds: 1, errors: errs, repairedIds: [] };
    const candidate = { ...assembly, parts };
    const after = buildAssembly(candidate)?.gateErrors ?? [];
    // 나빠졌으면 되돌린다 — 수리가 악화시키는 것을 통과시키지 않는다.
    if (after.length >= errs.length) return { assembly, rounds: 1, errors: errs, repairedIds: [] };
    return { assembly: candidate, rounds: 1, errors: after, repairedIds };
  } catch {
    // 수리 자체가 실패해도 **원본을 돌려준다**(수리는 부가 기능이지 필수 경로가 아니다).
    return { assembly, rounds: 0, errors: errs, repairedIds: [] };
  }
}

/**
 * ★260803 — **export 한다.** assemble 라우트가 **자기 목록 16종을 따로 하드코딩**하고
 * 있었다(실측: ALL_TYPES 38종 중 22종 누락 — slab_with_openings·composite·revolve 포함).
 * 같은 단일소스 결손의 다섯 번째 판이다. 한 곳에서만 만든다.
 */
export function VOCAB_SPEC() {
  // 분류 프롬프트(`TYPE_LIST`)와 **같은 한 줄 생성기**를 쓴다 — 두 벌이면 또 갈린다.
  return ALL_TYPES.map((t) => `- ${typeSpecLine(t)}`).join('\n');
}

const ASM_PROMPT = (desc) => `자연어 제품 설명을 복합 어셈블리 계획(JSON)으로 변환하라.

각 부품은 아래 어휘 중 하나다. **목록에 없는 type 을 만들지 마라** — 게이트에서 거부된다.
${VOCAB_SPEC()}
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
  /**
   * ⚠ 260802 — 실측 8건 중 **3건이 `MAX_TOKENS`** 였다(bad JSON). 원인은 이 파일 위쪽
   *   `callAiJson` 주석에 이미 적혀 있었다: gemini-2.5 의 **thinking 이 출력 토큰을
   *   소진**한다. `edit-part.mjs` 는 `thinkingBudget: 0` 을 쓰고 있었는데 **여기만 안 썼다.**
   *   해법이 리포 안에 있는데 한 경로만 안 쓰던 것이다.
   * ⚠ 실패한 호출은 53~88초가 걸렸고 **성공한 1건은 2.4초**였다 — 오래 생각할수록 실패했다.
   */
  const { data, model, fallbackReasons, usage } = await callAiJson(ASM_PROMPT(description), ASSEMBLY_SCHEMA, {
    ...(models ? { models } : {}),
    thinkingBudget: 0,
    maxOutputTokens: 16384,
  });
  /**
   * ★260803 — **결정론 교정을 LLM 수리 앞에 둔다.**
   *
   * 어휘 오분류(와셔를 flange 로, 사각 개구를 원형 holes 로)는 **판단이 아니라 규칙**이라
   * 왕복 없이 고쳐진다. 라이브 실측에서 이 두 유형이 게이트 에러의 대부분이었다.
   * ⚠ 순서가 중요하다 — 뒤에 두면 `repairAgainstGate` 가 **틀린 어휘의 스키마로** 치수를
   *   다시 물어보게 된다(플랜지 스키마로 와셔의 볼트원을 요구 → 모델이 없는 값을 지어낸다).
   * ⚠ 교정 내역은 반환값에 실어 보낸다. 조용히 고치면 사용자가 무엇이 바뀌었는지 모른다.
   */
  const { resolveAssembly } = await import('./auto-fix.mjs');
  const fixed = resolveAssembly(data); // drop 없음 — 먼저 LLM 수리에 기회를 준다
  const repaired = await repairAgainstGate(fixed.assembly, description, { models });
  /**
   * ★260803 — **수리를 다 쓰고도 남은 부품은 빼고 결과를 낸다.**
   * 실측: 부품 4개 중 1개가 걸리면 `buildAssembly` 가 `parts:0 · openscad:false` 를 내
   * **멀쩡한 3개까지 버려졌다.** 이제 3부품 조립체 + 드롭 1건 보고가 나간다.
   * ⚠ 질량이 그만큼 **과소**다 — `dropped[]` 에 원본 파라미터를 실어 되살릴 수 있게 한다.
   */
  const final = repaired.errors?.length
    ? resolveAssembly(repaired.assembly, { drop: true })
    : { assembly: repaired.assembly, corrections: [], dropped: [], allFailed: false };

  /**
   * ★260803 (B1) — **축 2: 이 숫자가 어디서 왔는가.**
   *
   * 여기까지 오면 형상은 나온다(§0.4 원칙). 그런데 **어느 치수가 사용자가 준 값이고
   * 어느 것이 LLM 이 채운 통상값인지 표시가 없었다.** 그 상태로 「어떤 입력이든 결과를 낸다」를
   * 밀면 가정을 검증된 것처럼 내보내게 된다.
   *
   * 두 신호를 쓴다 — 둘 다 결정론이다(LLM 을 다시 부르지 않는다):
   *   ① **원문 숫자 대조** — 값이 설명문에 없으면 `assumed`
   *   ② **수리 이력** — `repairAgainstGate` 가 손댄 부품은 전량 `assumed`
   *      (「미기입은 통상값」 프롬프트로 재추출된 값이라 근거를 보장할 수 없다)
   */
  const { annotateAssembly, assemblyProvenance } = await import('./provenance.mjs');
  const annotated = annotateAssembly(final.assembly, description, { repairedIds: repaired.repairedIds ?? [] });
  const provenance = assemblyProvenance(annotated, { dropped: final.dropped });

  return {
    assembly: annotated, model, repairRounds: repaired.rounds,
    gateErrors: final.dropped.length ? [] : repaired.errors,
    corrections: [...fixed.corrections, ...final.corrections],
    dropped: final.dropped, degraded: final.dropped.length > 0, allFailed: final.allFailed,
    provenance, fallbackReasons, usage,
  };
}

const isMain = process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('from-text.mjs');
if (isMain && process.argv[2]) {
  const { intent, model, usage } = await textToIntent(process.argv[2]);
  console.log(JSON.stringify(intent, null, 1));
  console.log('--- model:', model, 'tokens:', usage?.totalTokenCount, '| confidence:', intent.confidence);
}
