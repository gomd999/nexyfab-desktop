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
import { PARAMS } from './reconstruct.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** ```json 울타리·앞뒤 산문 제거 — 스키마를 끈 회차에서만 필요하다. */
export function stripFences(text) {
  const t = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/,'');
  const i = t.indexOf('{'), j = t.lastIndexOf('}');
  return i >= 0 && j > i ? t.slice(i, j + 1) : t;
}

/**
 * 스키마를 끈 회차에 붙이는 지시 — 스키마가 하던 일을 **말로** 대신한다.
 * ⚠ 스키마 없이 보내면서 형식을 안 알려 주면 산문이 돌아온다.
 */
const NO_SCHEMA_HINT = [
  '',
  '⚠ 출력은 **JSON 객체 하나만**. 마크다운 울타리·설명 문장을 붙이지 마라.'
  + ' 필요한 키만 넣고 값이 없는 키는 아예 생략하라(빈 문자열·null 로 채우지 마라).',
].join(String.fromCharCode(10, 10));

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
  const baseConfig = { temperature: 0, response_mime_type: 'application/json', maxOutputTokens };
  if (schema) baseConfig.response_schema = schema;
  /**
   * ⚠ 260802 — 본문을 **모델 루프 밖에서 한 번** 만들고 있었다. 그런데 `thinkingConfig` 는
   *   모델마다 받는 값이 다르다: `gemini-2.5-pro` 는 **thinking 이 필수**라
   *   `Budget 0 is invalid. This model only works in thinking mode.` 로 **400** 이 난다
   *   (flash 는 0 을 받는다). 한 벌 본문을 전 모델에 쓰면 폴백이 통째로 죽는다 —
   *   실측: MAX_TOKENS 를 고치려고 `thinkingBudget: 0` 을 넣었더니 400 이 4건 났다.
   * ⚠ 모델 이름으로 분기하지 않는다(모델은 계속 바뀐다). **그 400 을 만나면 해당 모델만
   *   thinking 없이 한 번 더** 시도한다 — 능력 판별을 응답에서 배운다.
   */
  /**
   * ★260731 — `withSchema` 추가. **스키마를 끄는 것은 이미 이 파일이 적어 둔 우회로인데
   *   실제로는 한 번도 쓰이지 않았다**(위 `schema=null` 주석 참조).
   *
   *   실측(8케이스): `flash: bad_json_MAX_TOKENS` → `pro` 로 폴백 → **1.1~8.5s 가 89~125s**.
   *   그런데 잘린 요청은 「길이 2400 깊이 600 높이 900 카운터」 — **상자 하나**다.
   *   16,384 토큰을 쓸 일이 아니다. 즉 상한이 낮은 게 아니라 **구조화 출력이 폭주**한 것이고,
   *   상한을 올리면 낭비만 커진다.
   * ⚠ 그래서 MAX_TOKENS 를 만나면 **모델을 바꾸기 전에 같은(빠른) 모델로 스키마 없이** 한 번 더.
   *   느린 모델로 도망가는 것은 마지막 수단이다.
   */
  /**
   * ★260731 — **스키마 회차의 출력 상한을 관측값 위에 다시 놓는다.**
   *
   * 실측(8케이스 출력 토큰):
   * ```
   *   스키마로 성공한 회차   73 · 80 · 103 · 477 · 633
   *   스키마 없이 성공한 회차 65 · 276 · 1540      ← 관측 최대
   *   폭주 회차               16,384 전부 소진 → 약 55초 낭비 후 MAX_TOKENS
   * ```
   * 정상 응답 최대가 1,540 인데 상한이 16,384 였다 — **10배 여유를 폭주가 전부 태웠다.**
   * 상한을 관측 최대의 2배로 낮추면 폭주가 **5배 빨리** 드러나고, 그 뒤 스키마 없는
   * 회차(여전히 16,384)가 정상 응답을 만든다.
   * ⚠ 정상적으로 큰 어셈블리가 이 상한에 걸리면? **실패하지 않는다** — 스키마 없는
   *   회차로 넘어가 성공한다(실측 1,540 토큰 케이스가 그 경로로 통과했다). 한 왕복을 더
   *   쓸 뿐이고, 그건 매번 55초를 버리는 것보다 싸다.
   */
  const SCHEMA_MAX_OUT = 3072;
  const bodyFor = (withThinking, withSchema = true) => {
    const cfg = { ...baseConfig };
    if (withSchema) cfg.maxOutputTokens = Math.min(baseConfig.maxOutputTokens ?? SCHEMA_MAX_OUT, SCHEMA_MAX_OUT);
    if (!withSchema) delete cfg.response_schema;
    return JSON.stringify({
      contents: [{ parts: [{ text: withSchema ? promptText : promptText + NO_SCHEMA_HINT }] }],
      generationConfig: withThinking && thinkingBudget !== undefined
        ? { ...cfg, thinkingConfig: { thinkingBudget } }
        : cfg,
    });
  };
  let lastErr;
  /**
   * ★260731 — **앞 모델이 왜 실패했는지가 버려지고 있었다.**
   *   폴백이 성공하면 아무도 사유를 보지 않는다. 그런데 실측(8케이스)에서
   *   `flash` 1.3~8.0s 대 `pro` 91~99s — **폴백 한 번이 지연을 12배로 만든다.**
   *   무엇이 flash 를 떨어뜨리는지 모르면 그 12배를 줄일 수 없다.
   * ⚠ 사유를 반환값에 실어 보낸다. 로그로만 남기면 하네스가 집계하지 못한다.
   */
  const fallbackReasons = [];
  for (const model of models) {
    let useThinking = true;
    let useSchema = Boolean(schema);
    let body = bodyFor(useThinking, useSchema);
    for (let attempt = 0; attempt < 3; attempt++) {
      let res;
      try {
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey()}`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body,
        });
      } catch (e) { lastErr = e; fallbackReasons.push(`${model}: network`); await sleep(1000); continue; }
      if (!res.ok) {
        if (res.status === 503 || res.status === 429) { lastErr = new Error(`${model} ${res.status}`); fallbackReasons.push(`${model}: http_${res.status}`); await sleep(1500 * (attempt + 1)); continue; }
        const text = await res.text();
        /**
         * thinking 이 **필수인 모델**은 `thinkingBudget: 0` 을 거부한다(400).
         * 모델 이름으로 분기하지 않고 **응답에서 배워** 그 모델만 thinking 없이 재시도한다.
         * ⚠ 한 번만 재시도한다 — 무한히 되돌리면 진짜 실패가 시간초과로 둔갑한다.
         */
        if (res.status === 400 && useThinking && /thinking mode|Budget \d+ is invalid/i.test(text)) {
          useThinking = false;
          body = bodyFor(false, useSchema);
          continue;
        }
        lastErr = new Error(`${model} ${res.status}: ${text.slice(0, 120)}`);
        fallbackReasons.push(`${model}: http_${res.status}`);
        break; // 비-일시적 에러 → 다음 모델로
      }
      const j = await res.json();
      const text = j.candidates?.[0]?.content?.parts?.[0]?.text;
      const finish = j.candidates?.[0]?.finishReason;
      if (!text) { lastErr = new Error(`${model} empty (${finish})`); fallbackReasons.push(`${model}: empty_${finish}`); continue; }
      // ⚠ 스키마를 끄면 모델이 ```json 울타리를 붙일 수 있다 — 벗겨 내고 파싱한다.
      const cleaned = useSchema ? text : stripFences(text);
      // 출력 토큰 실측 — 상한을 「어림」이 아니라 **관측값** 위에 두기 위해.
      const usage = { out: j.usageMetadata?.candidatesTokenCount, total: j.usageMetadata?.totalTokenCount, schema: useSchema };
      try { return { data: JSON.parse(cleaned), model, repaired: false, fallbackReasons, usage }; }
      catch {
        try { const fixed = repairJsonNumbers(cleaned); if (fixed !== cleaned) return { data: JSON.parse(fixed), model, repaired: true, fallbackReasons, usage }; }
        catch { /* fall through */ }
        lastErr = new Error(`${model} bad JSON (${finish})`);
        fallbackReasons.push(`${model}: bad_json_${finish}`);
        if (finish === 'MAX_TOKENS') {
          // 구조화 출력 폭주 → **같은 모델로** 스키마 없이 한 번 더. 느린 모델 폴백은 그 다음이다.
          if (useSchema) {
            useSchema = false;
            body = bodyFor(useThinking, false);
            fallbackReasons.push(`${model}: retry_without_schema`);
            continue;
          }
          break; // 스키마 없이도 폭주하면 재시도 무의미 → 다음 모델로
        }
      }
    }
  }
  throw lastErr;
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
    if (!errs.length) return { assembly, rounds: 0, errors: [] };
    /**
     * ★ 실패한 **부품만** 그 어휘의 `TYPE_SCHEMAS` 로 다시 받는다.
     *   어셈블리 스키마 하나로 전 어휘의 파라미터를 받으려 하면 키가 섞인다(위 주석 참조).
     *   타입별 스키마는 **그 타입의 키만** 있어 모델이 고를 여지가 없다.
     */
    const failedIds = new Set(errs.map((e) => String(e).split(':')[0]?.trim()).filter(Boolean));
    const parts = [...(assembly?.parts ?? [])];
    let changed = 0;
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
        const { data: fixed } = await callGeminiJson(ask, schema, {
          ...(models ? { models } : {}), thinkingBudget: 0, maxOutputTokens: 2048,
        });
        if (fixed && typeof fixed === 'object') { parts[i] = { ...p, params: { ...p.params, ...fixed } }; changed += 1; }
      } catch { /* 이 부품은 못 고쳤다 — 나머지는 계속 시도한다 */ }
    }
    if (!changed) return { assembly, rounds: 1, errors: errs };
    const candidate = { ...assembly, parts };
    const after = buildAssembly(candidate)?.gateErrors ?? [];
    // 나빠졌으면 되돌린다 — 수리가 악화시키는 것을 통과시키지 않는다.
    if (after.length >= errs.length) return { assembly, rounds: 1, errors: errs };
    return { assembly: candidate, rounds: 1, errors: after };
  } catch {
    // 수리 자체가 실패해도 **원본을 돌려준다**(수리는 부가 기능이지 필수 경로가 아니다).
    return { assembly, rounds: 0, errors: errs };
  }
}

function VOCAB_SPEC() {
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
   *   `callGeminiJson` 주석에 이미 적혀 있었다: gemini-2.5 의 **thinking 이 출력 토큰을
   *   소진**한다. `edit-part.mjs` 는 `thinkingBudget: 0` 을 쓰고 있었는데 **여기만 안 썼다.**
   *   해법이 리포 안에 있는데 한 경로만 안 쓰던 것이다.
   * ⚠ 실패한 호출은 53~88초가 걸렸고 **성공한 1건은 2.4초**였다 — 오래 생각할수록 실패했다.
   */
  const { data, model, fallbackReasons, usage } = await callGeminiJson(ASM_PROMPT(description), ASSEMBLY_SCHEMA, {
    ...(models ? { models } : {}),
    thinkingBudget: 0,
    maxOutputTokens: 16384,
  });
  const repaired = await repairAgainstGate(data, description, { models });
  return { assembly: repaired.assembly, model, repairRounds: repaired.rounds, gateErrors: repaired.errors, fallbackReasons, usage };
}

const isMain = process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('from-text.mjs');
if (isMain && process.argv[2]) {
  const { intent, model, usage } = await textToIntent(process.argv[2]);
  console.log(JSON.stringify(intent, null, 1));
  console.log('--- model:', model, 'tokens:', usage?.totalTokenCount, '| confidence:', intent.confidence);
}
