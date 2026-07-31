/**
 * truncation — **응답이 상한에 걸려 잘렸는지**를 제공자 신호에서 읽는다 (260731).
 *
 * ## 왜 필요한가
 * 제공자 7곳 중 **어느 곳도 절단을 구별하지 않고 있었다.** 그래서 잘린 응답이
 * 호출부에 도착하면 「형식이 이상하다」로만 보였고, 원인 규명에 매번 여러 단계가 걸렸다:
 * ```
 *   imageIntentFromSketch  maxTokens 500  → 24장 중 16장 NON_JSON
 *                          원문을 찍어 보고서야 "params": 에서 잘린 것을 알았다
 *   from-text 어셈블리      maxTokens 16384 → bad JSON → 느린 모델 폴백(지연 12배)
 * ```
 * **증상은 파싱 실패였지만 원인은 자리 부족**이었고, 대응은 정반대다 —
 * 프롬프트를 손질할 일이 아니라 상한·thinking 을 조정할 일이다.
 *
 * ## ⚠ 세 상태를 구별한다 — 「모른다」를 「안 잘렸다」로 바꾸지 않는다
 * ```
 *   true      제공자가 절단이라고 말했다
 *   false     제공자가 정상 종료라고 말했다
 *   undefined 제공자가 아무 말도 안 했다   ← **`false` 가 아니다**
 * ```
 * 모르는 것을 `false` 로 채우면 「안 잘렸음이 확인됐다」로 읽힌다 — 그건 거짓이다.
 */

/** 제공자별 절단 표지. 소문자로 비교한다(대소문자 규약이 제공자마다 다르다). */
const TRUNCATED = new Set([
  'max_tokens',   // Anthropic
  'maxtokens',    // Gemini `MAX_TOKENS`
  'length',       // OpenAI 호환(deepseek·openai·openrouter·qwen·local)
  'max_output_tokens',
]);

/** 정상 종료 표지 — 이것들이면 **잘리지 않았다고 말할 수 있다.** */
const COMPLETED = new Set([
  'stop', 'end_turn', 'eos', 'complete', 'finished',
]);

/**
 * @param raw 제공자가 준 종료 사유 문자열(`finish_reason` · `finishReason` · `stop_reason`)
 * @returns 응답에 그대로 펼쳐 넣을 수 있는 조각. 모르면 `truncated` 를 **생략**한다.
 */
export function truncationOf(raw: unknown): { truncated?: boolean; finishReason?: string } {
  if (typeof raw !== 'string' || !raw.trim()) return {};
  const key = raw.trim().toLowerCase().replace(/[\s-]/g, '_');
  const flat = key.replace(/_/g, '');
  if (TRUNCATED.has(key) || TRUNCATED.has(flat)) return { truncated: true, finishReason: raw };
  if (COMPLETED.has(key) || COMPLETED.has(flat)) return { truncated: false, finishReason: raw };
  /**
   * 모르는 사유(안전필터·도구호출·제공자 신규값 등) — **판정하지 않고 원문만 남긴다.**
   * 여기서 `false` 로 단정하면 새 절단 표지가 생겼을 때 조용히 놓친다.
   */
  return { finishReason: raw };
}

/**
 * 잘린 응답에 붙일 설명 — 호출부가 사용자·로그에 그대로 쓸 수 있게.
 * ⚠ 「모델이 형식을 못 지켰다」로 오해하지 않도록 **원인을 명시**한다.
 */
export function truncationNote(r: { truncated?: boolean; finishReason?: string }, maxTokens?: number): string | null {
  if (r.truncated !== true) return null;
  return `응답이 출력 상한${maxTokens ? `(${maxTokens} 토큰)` : ''}에 걸려 잘렸습니다`
    + ` — 모델이 형식을 어긴 것이 아니라 **쓸 자리가 부족**했습니다.`
    + ` 상한을 올리거나(생각 토큰을 쓰는 모델은 여유가 더 필요합니다) 출력을 짧게 요구하세요.`;
}
