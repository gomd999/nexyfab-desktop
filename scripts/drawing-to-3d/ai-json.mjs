/**
 * 구조화 JSON 호출의 단일 창구 — **DeepSeek(기본) · OpenAI · Gemini(폴백)** 배선.
 *
 * 이력:
 *   260802  Gemini → OpenAI(gpt-5.6-sol) 전면 전환. Gemini 전용 재시도 로직을 이 모듈로 흡수.
 *   260803  **기본을 Gemini 로 되돌린다**(사용자 지시). OpenAI 배선은 지우지 않는다 —
 *           `models` 에 `gpt-*` 를 넣거나 `NEXYFAB_AI_JSON_MODELS` 로 언제든 되돌아간다.
 *
 * ⚠ 두 제공자는 **재시도 규약이 다르다.** 하나로 합치지 않고 백엔드 함수를 둘로 두고
 *   모델 이름으로 라우팅한다:
 *     Gemini  — response_schema 폭주 시 **스키마를 끄고** 재시도 / thinkingBudget 400 학습
 *     OpenAI  — `temperature` 거부(400) 시 빼고 재시도 / `max_completion_tokens` 사용
 *   모델 이름으로 능력을 미리 단정하지 않고 **응답에서 배운다**(레포 기존 관례).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { apiKey, repairJsonNumbers } from './extract.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** ```json 울타리·앞뒤 산문 제거 — 스키마를 끈 회차에서만 필요하다. */
function stripFences(text) {
  const t = String(text).trim().replace(/^`{3}(?:json)?\s*/i, '').replace(/`{3}\s*$/, '');
  const i = t.indexOf('{'), j = t.lastIndexOf('}');
  return i >= 0 && j > i ? t.slice(i, j + 1) : t;
}

/**
 * 기본 모델 — 기계 CAD는 DeepSeek chat 우선, 다음 OpenAI, 마지막 Gemini.
 * 관리/운영에서 `NEXYFAB_AI_JSON_MODELS`로 명시적으로 덮어쓸 수 있다.
 */
export function defaultJsonModels() {
  const raw = process.env.NEXYFAB_AI_JSON_MODELS;
  if (raw) {
    const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (list.length) return list;
  }
  return ['deepseek-chat', 'gpt-4o-mini', 'gemini-2.5-flash'];
}

/** 모델 이름 → 백엔드. */
function backendFor(model) {
  if (/^deepseek/i.test(String(model))) return 'deepseek';
  return /^(gpt-|o\d)/i.test(String(model)) ? 'openai' : 'gemini';
}

// ─── OpenAI 배선 (260802 도입 — 유지) ───────────────────────────────────────

export function openaiApiKey() {
  // 1순위: 환경변수 (사이트 서버·Railway·프로덕션에서 이 경로로 동작).
  const envKey = process.env.OPENAI_API_KEY;
  if (envKey) return envKey;
  // 2순위(로컬 CLI 개발): parent .env 파일. 여러 후보 경로 시도(extract.mjs apiKey()와 동일 규약).
  for (const p of [
    process.env.NEXYFAB_ENV_PATH,
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '..', '..', '.env'),
  ].filter(Boolean)) {
    try {
      const m = readFileSync(p, 'utf8').match(/^OPENAI_API_KEY=(\S+)/m);
      if (m) return m[1];
    } catch { /* 다음 후보 */ }
  }
  throw new Error('OPENAI_API_KEY 가 설정되지 않았다(환경변수 또는 parent .env)');
}

export function deepseekApiKey() {
  const envKey = process.env.DEEPSEEK_API_KEY || process.env.NEXYFAB_DEEPSEEK_API_KEY;
  if (envKey) return envKey;
  for (const p of [
    process.env.NEXYFAB_ENV_PATH,
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '..', '..', '.env'),
  ].filter(Boolean)) {
    try {
      const m = readFileSync(p, 'utf8').match(/^(?:NEXYFAB_)?DEEPSEEK_API_KEY=(\S+)/m);
      if (m) return m[1];
    } catch { /* 다음 후보 */ }
  }
  throw new Error('DEEPSEEK_API_KEY 가 설정되지 않았다(환경변수 또는 parent .env)');
}

/**
 * Gemini 스타일 스키마(대문자 OBJECT/STRING/NUMBER/ARRAY/BOOLEAN)를 사람이 읽는
 * 필드 설명 텍스트로 변환한다 — OpenAI json_object 모드는 스키마를 강제하지 않으므로
 * 형식을 프롬프트에 직접 적어 줘야 한다.
 *
 * ⚠ Gemini responseSchema 를 OpenAI strict json_schema 모드로 그대로 변환하지 않는다 —
 *   strict 는 모든 속성이 required 여야 하는데 기존 스키마 다수가 옵셔널 필드를 갖고 있어
 *   (예: holes[].fit) 변환 규칙이 하나라도 틀리면 400 이거나 필드가 조용히 빠진다.
 */
export function schemaToHint(schema, indent = '') {
  if (!schema || typeof schema !== 'object') return '';
  if (schema.type === 'OBJECT') {
    const req = new Set(schema.required || []);
    return Object.entries(schema.properties || {}).map(([k, v]) => {
      const mark = req.has(k) ? '' : '(선택)';
      if (v.type === 'OBJECT' || v.type === 'ARRAY') return `${indent}- ${k}${mark}:\n${schemaToHint(v, indent + '    ')}`;
      return `${indent}- ${k}${mark}: ${v.type}${v.enum ? ` (${v.enum.join('|')} 중 하나)` : ''}`;
    }).join('\n');
  }
  if (schema.type === 'ARRAY') return `${indent}array, 각 원소:\n${schemaToHint(schema.items, indent + '  ')}`;
  return `${indent}${schema.type}${schema.enum ? ` (${schema.enum.join('|')} 중 하나)` : ''}`;
}

/**
 * OpenAI Chat Completions 기반 구조화 JSON. 신뢰성 3중 방어:
 *   1) 모델 폴백 — models 배열 순서대로.
 *   2) 429/5xx 지수 백오프(모델당 최대 3회).
 *   3) JSON 리페어(폭주 지수·긴소수) 후 재파싱.
 * @returns { data, model, repaired }
 */
export async function callOpenAiJson(promptText, schema, { models = ['gpt-5.6-sol'], maxOutputTokens = 8192 } = {}) {
  const schemaHint = schema
    ? '\n\n⚠ 출력은 JSON 객체 하나만(마크다운 울타리·설명 문장 금지). 다음 필드를 채워라:\n' + schemaToHint(schema)
    : '\n\n⚠ 출력은 JSON 객체 하나만(마크다운 울타리·설명 문장 금지). 필요한 키만 넣고 값이 없는 키는 아예 생략하라(빈 문자열·null 로 채우지 마라).';
  const fullPrompt = promptText + schemaHint;

  let lastErr;
  const fallbackReasons = [];
  for (const model of models) {
    // ⚠ 260802 실측 — gpt-5.6-sol(추론 계열)은 `temperature` 를 기본값(1) 외로 주면 400,
    //   `max_tokens` 대신 `max_completion_tokens` 를 요구한다(HTTP curl 로 직접 확인).
    //   모델 이름으로 미리 분기하지 않는다(모델은 계속 바뀐다) — **그 400 을 만나면**
    //   temperature 를 빼고 한 번 더 시도한다.
    let useTemperature = true;
    const bodyFor = () => JSON.stringify({
      model,
      ...(useTemperature ? { temperature: 0 } : {}),
      max_completion_tokens: maxOutputTokens,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: fullPrompt }],
    });
    for (let attempt = 0; attempt < 3; attempt++) {
      let res;
      try {
        res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${openaiApiKey()}` },
          body: bodyFor(),
        });
      } catch (e) { lastErr = e; await sleep(1000); continue; }

      if (!res.ok) {
        if (res.status === 429 || res.status >= 500) { lastErr = new Error(`${model} ${res.status}`); await sleep(1500 * (attempt + 1)); continue; }
        const bodyText = await res.text().catch(() => '');
        if (res.status === 400 && useTemperature && /temperature/i.test(bodyText)) {
          useTemperature = false;
          fallbackReasons.push(`${model}: retry_without_temperature`);
          continue;
        }
        lastErr = new Error(`${model} ${res.status}: ${bodyText.slice(0, 300)}`);
        fallbackReasons.push(`${model}: HTTP ${res.status}`);
        break; // 4xx(429 제외) — 이 모델로는 재시도해도 소용없다, 다음 모델로.
      }

      const j = await res.json();
      const choice = j.choices?.[0];
      const text = choice?.message?.content;
      const fin = choice?.finish_reason;
      if (!text) { lastErr = new Error(`${model} empty(${fin})`); fallbackReasons.push(`${model}: empty(${fin})`); break; }

      try {
        return { data: JSON.parse(text), model, repaired: false, fallbackReasons };
      } catch {
        try {
          const fx = repairJsonNumbers(text);
          if (fx !== text) return { data: JSON.parse(fx), model, repaired: true, fallbackReasons };
        } catch { /* 리페어도 실패 — 아래에서 사유 기록 후 다음으로 */ }
        lastErr = new Error(`${model} bad JSON(${fin})`);
        fallbackReasons.push(`${model}: bad JSON(${fin})`);
        if (fin === 'length') break; // 절단 — 같은 모델 재시도로는 안 고쳐진다, 다음 모델로.
      }
    }
  }
  const err = lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  err.fallbackReasons = fallbackReasons;
  throw err;
}

// ─── DeepSeek 배선(기본) ──────────────────────────────────────────

export async function callDeepSeekJson(promptText, schema, { models = ['deepseek-chat'], maxOutputTokens = 8192 } = {}) {
  const schemaHint = schema
    ? '\n\n⚠ 출력은 JSON 객체 하나만(마크다운 울타리·설명 문장 금지). 다음 필드를 채워라:\n' + schemaToHint(schema)
    : '\n\n⚠ 출력은 JSON 객체 하나만. 마크다운 울타리·설명 문장을 붙이지 마라.';
  const fullPrompt = promptText + schemaHint;
  const fallbackReasons = [];
  let lastErr;
  for (const model of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      let res;
      try {
        res = await fetch(`${(process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${deepseekApiKey()}` },
          body: JSON.stringify({
            model,
            temperature: 0,
            max_tokens: Math.min(8192, Math.max(512, Number(maxOutputTokens) || 8192)),
            response_format: { type: 'json_object' },
            messages: [{ role: 'user', content: fullPrompt }],
          }),
        });
      } catch (e) {
        lastErr = e;
        fallbackReasons.push(`${model}: network`);
        await sleep(1000 * (attempt + 1));
        continue;
      }
      if (!res.ok) {
        const bodyText = await res.text().catch(() => '');
        lastErr = new Error(`${model} ${res.status}: ${bodyText.slice(0, 300)}`);
        fallbackReasons.push(`${model}: HTTP ${res.status}`);
        if (res.status === 429 || res.status >= 500) { await sleep(1500 * (attempt + 1)); continue; }
        break;
      }
      const j = await res.json();
      const choice = j.choices?.[0];
      const raw = choice?.message?.content;
      const finish = choice?.finish_reason;
      if (!raw) {
        lastErr = new Error(`${model} empty(${finish})`);
        fallbackReasons.push(`${model}: empty(${finish})`);
        break;
      }
      const cleaned = stripFences(raw);
      const usage = { out: j.usage?.completion_tokens, total: j.usage?.total_tokens, schema: Boolean(schema) };
      try { return { data: JSON.parse(cleaned), model, repaired: false, fallbackReasons, usage }; }
      catch {
        try {
          const fixed = repairJsonNumbers(cleaned);
          if (fixed !== cleaned) return { data: JSON.parse(fixed), model, repaired: true, fallbackReasons, usage };
        } catch { /* 다음 모델 */ }
        lastErr = new Error(`${model} bad JSON(${finish})`);
        fallbackReasons.push(`${model}: bad JSON(${finish})`);
        break;
      }
    }
  }
  const err = lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  err.fallbackReasons = fallbackReasons;
  throw err;
}

// ─── Gemini 배선 (기본, 260803 복원) ───────────────────────────────────────

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
  const err = lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  err.fallbackReasons = fallbackReasons;
  throw err;
}

// ─── 공용 진입점 ────────────────────────────────────────────────────────────

/**
 * 모델 이름으로 백엔드를 골라 호출한다. `models` 를 섞어 써도 된다 —
 * 예: `['gemini-2.5-flash', 'gpt-5.6-sol']` 이면 Gemini 실패 시 OpenAI 로 넘어간다.
 *
 * ⚠ 백엔드 함수에는 **모델을 하나씩** 넘긴다 — 각 백엔드의 모델별 재시도(스키마 우회 ·
 *   temperature 제거)는 그대로 돌면서, 모델 간 폴백만 여기서 관장한다.
 * @returns { data, model, repaired, fallbackReasons, usage? }
 */
export async function callAiJson(promptText, schema, opts = {}) {
  const { models = defaultJsonModels(), ...rest } = opts;
  const list = Array.isArray(models) && models.length ? models : defaultJsonModels();
  const fallbackReasons = [];
  let lastErr;
  for (const model of list) {
    const backend = backendFor(model);
    const call = backend === 'deepseek' ? callDeepSeekJson : backend === 'openai' ? callOpenAiJson : callGeminiJson;
    try {
      const out = await call(promptText, schema, { ...rest, models: [model] });
      return { ...out, fallbackReasons: [...fallbackReasons, ...(out.fallbackReasons ?? [])] };
    } catch (e) {
      lastErr = e;
      fallbackReasons.push(...(e?.fallbackReasons ?? [`${model}: ${e?.message ?? e}`]));
    }
  }
  const err = lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  err.fallbackReasons = fallbackReasons;
  throw err;
}
