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
  /** Force a specific model name (otherwise provider default) */
  model?: string;
  /** Logical task name for telemetry / per-provider model routing */
  task?: string;
  /** Caller's user id for per-user observability in nf_api_usage */
  userId?: string;
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
}

export type ProviderName = 'deepseek' | 'openai' | 'anthropic' | 'local' | 'gemini';

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
