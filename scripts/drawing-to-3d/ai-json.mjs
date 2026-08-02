/**
 * OpenAI Chat Completions 기반 구조화 JSON 호출 (260802) — Gemini에서 이전.
 *
 * 이전 Gemini 버전(from-text.mjs callGeminiJson, compose.mjs 인라인 fetch)의 신뢰성
 * 전략(모델 폴백 · 429/5xx 지수 백오프 · JSON 리페어)을 유지하되 OpenAI 프로토콜로
 * 재작성한다: response_format json_object, finish_reason 'length'(=Gemini MAX_TOKENS).
 *
 * ⚠ Gemini responseSchema(대문자 OBJECT/STRING/NUMBER 타입)를 OpenAI strict
 *   json_schema 모드로 그대로 변환하지 않는다 — strict 모드는 모든 속성이
 *   required여야 하는데 기존 스키마 다수가 옵셔널 필드를 갖고 있어(예: holes[].fit),
 *   변환 규칙이 하나라도 틀리면 API가 400을 내거나 필드가 조용히 빠질 위험이 있다.
 *   대신 스키마를 **사람이 읽을 필드 설명**으로 바꿔 프롬프트에 붙이고 json_object
 *   모드(항상 문법적으로 유효한 JSON을 보장)를 쓴다 — Gemini 버전이 이미
 *   "스키마 없는 회차"(NO_SCHEMA_HINT)로 검증해 둔 우회로와 같은 전략이다.
 */
import { readFileSync } from 'node:fs';
import { repairJsonNumbers } from './extract.mjs';

export function openaiApiKey() {
  // 1순위: 환경변수 (사이트 서버·Railway·프로덕션에서 이 경로로 동작).
  const envKey = process.env.OPENAI_API_KEY;
  if (envKey) return envKey;
  // 2순위(로컬 CLI 개발): parent .env 파일. 여러 후보 경로 시도(extract.mjs apiKey()와 동일 규약).
  for (const p of [
    process.env.NEXYFAB_ENV_PATH,
    'C:/Users/gomd9/Downloads/nexysys_1/.env',
    new URL('../../../../.env', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  ].filter(Boolean)) {
    try {
      const m = readFileSync(p, 'utf8').match(/^OPENAI_API_KEY=(\S+)/m);
      if (m) return m[1];
    } catch { /* 다음 후보 */ }
  }
  throw new Error('OPENAI_API_KEY 가 설정되지 않았다(환경변수 또는 parent .env)');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Gemini 스타일 스키마(대문자 OBJECT/STRING/NUMBER/ARRAY/BOOLEAN)를 사람이 읽는
 * 필드 설명 텍스트로 변환한다 — json_object 모드는 스키마를 강제하지 않으므로
 * 형식을 프롬프트에 직접 적어 줘야 한다.
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
 * 텍스트 프롬프트 → 구조화 JSON, 신뢰성 3중 방어(Gemini 버전과 동일 구조):
 *   1) 모델 폴백 — models 배열 순서대로.
 *   2) 429/5xx 지수 백오프(모델당 최대 3회).
 *   3) JSON 리페어(폭주 지수·긴소수) 후 재파싱.
 * @returns { data, model, repaired }
 */
export async function callAiJson(promptText, schema, { models = ['gpt-5.6-sol'], maxOutputTokens = 8192 } = {}) {
  const schemaHint = schema
    ? '\n\n⚠ 출력은 JSON 객체 하나만(마크다운 울타리·설명 문장 금지). 다음 필드를 채워라:\n' + schemaToHint(schema)
    : '\n\n⚠ 출력은 JSON 객체 하나만(마크다운 울타리·설명 문장 금지). 필요한 키만 넣고 값이 없는 키는 아예 생략하라(빈 문자열·null 로 채우지 마라).';
  const fullPrompt = promptText + schemaHint;

  let lastErr;
  const fallbackReasons = [];
  for (const model of models) {
    // ⚠ 260802 실측 — gpt-5.6-sol(추론 계열)은 `temperature` 를 기본값(1) 외로 주면 400,
    //   `max_tokens` 대신 `max_completion_tokens` 를 요구한다(HTTP curl 로 직접 확인).
    //   모델 이름으로 미리 분기하지 않는다(모델은 계속 바뀐다) — from-text.mjs 의
    //   thinkingBudget 학습과 같은 방식으로, **그 400 을 만나면** temperature 를 빼고
    //   한 번 더 시도한다.
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
