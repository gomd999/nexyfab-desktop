/**
 * Provider-agnostic chat completion interface.
 *
 * Modeled after the OpenAI /chat/completions request shape because it's
 * the de-facto standard supported by DeepSeek, OpenAI, Groq, Together,
 * Anthropic (via their /v1/messages compat shim), Ollama, vLLM, and llama.cpp.
 *
 * Use this interface from API routes instead of calling fetch() against a
 * specific vendor — the provider/model is resolved per-request via env vars
 * and a fallback chain so a single vendor outage does not take down AI features.
 */

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatCompletionRequest {
  messages: ChatMessage[];
  /** -1 / undefined → provider default */
  maxTokens?: number;
  /** 0..2; lower = more deterministic */
  temperature?: number;
  /** Wall-clock timeout in ms before AbortError (default 30s) */
  timeoutMs?: number;
  /** Force a specific provider for this call (skips fallback chain) */
  provider?: ProviderName;
  /** Prefer this provider first but keep the normal chain as fallback. Use for
   *  task-specific routing (e.g. spatial CAD codegen → gemini, fall back to
   *  deepseek if gemini is unconfigured/degraded). */
  preferProvider?: ProviderName;
  /** Force a specific model name (otherwise provider default) */
  model?: string;
  /** Logical task name for telemetry / per-provider model routing */
  task?: string;
  /** Caller's user id for per-user observability in nf_api_usage */
  userId?: string;
  /** Abort signal — when fired, the provider should cancel its fetch
   *  and reject the call. Plumbed from the request handler so an SSE
   *  client disconnect can stop in-flight provider work. */
  signal?: AbortSignal;
}

export interface ChatCompletionResponse {
  /** Raw model text — caller is responsible for JSON parsing if expected */
  text: string;
  /** Which provider actually served the request (after fallback) */
  provider: ProviderName;
  /** Which model was used */
  model: string;
  /** Approx prompt tokens, when reported by the provider */
  promptTokens?: number;
  /** Approx completion tokens, when reported by the provider */
  completionTokens?: number;
  /** Wall-clock latency in ms */
  latencyMs: number;
  /**
   * ★260731 — **응답이 상한에 걸려 잘렸는가.**
   *
   * 제공자 7곳 중 어느 곳도 절단을 구별하지 않고 있었다. 그래서 잘린 응답이 호출부에
   * 도착하면 **「형식이 이상하다」로만 보였다.** 실제로 두 번 물렸다:
   * ```
   *   imageIntentFromSketch  maxTokens 500 → 24장 중 16장 NON_JSON
   *                          (산문이 아니라 "params": 에서 잘림 — 원문을 찍어서야 알았다)
   *   from-text 어셈블리      maxTokens 16384 → bad JSON → 느린 모델 폴백(지연 12배)
   * ```
   * 두 번 다 **원인은 절단인데 증상은 파싱 실패**였고, 진단에 여러 단계가 걸렸다.
   * ⚠ 이 값이 `true` 인데 파싱이 실패했다면 **모델이 형식을 못 지킨 게 아니라 자리가
   *   부족한 것**이다 — 대응이 정반대다(프롬프트 손질 ❌ / 상한·thinking 조정 ⭕).
   * ⚠ 제공자가 신호를 안 주면 `undefined` 로 둔다 — `false`(=안 잘림)로 단정하지 않는다.
   */
  truncated?: boolean;
  /** 제공자가 준 원래 종료 사유 — 표준화하면 잃는 정보가 있어 원문도 남긴다. */
  finishReason?: string;
}

export type ProviderName = 'deepseek' | 'openai' | 'anthropic' | 'local' | 'gemini' | 'qwen' | 'openrouter';

export interface ProviderAdapter {
  readonly name: ProviderName;
  /** Cheap synchronous check — returns true if env vars are configured */
  isConfigured(): boolean;
  complete(req: ChatCompletionRequest): Promise<ChatCompletionResponse>;
}

export class AiProviderError extends Error {
  constructor(
    public readonly provider: ProviderName,
    public readonly status: number | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

export class AiNotConfiguredError extends Error {
  constructor() {
    super('No AI provider is configured. Set DEEPSEEK_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, or LOCAL_AI_BASE_URL.');
    this.name = 'AiNotConfiguredError';
  }
}
