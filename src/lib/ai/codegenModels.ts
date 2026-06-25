import type { ProviderName } from './types';

/**
 * The user-selectable models for CAD codegen (free-form + precise). One entry
 * = a label shown in the Studio's model picker mapped to a concrete
 * provider + model name. The route validates the chosen id against this list
 * (never trusts a raw provider/model from the client) and routes the call,
 * keeping the normal fallback chain behind the preferred provider.
 *
 * Availability depends on which API keys are configured:
 *   gemini  → GEMINI_API_KEY        (also powers vision)
 *   qwen    → DASHSCOPE_API_KEY      (qwen / glm / deepseek-v4 via Bailian)
 *   deepseek→ DEEPSEEK_API_KEY
 * An unconfigured provider is skipped at request time and the chain falls
 * back, so listing a model here is always safe.
 */
export interface CodegenModel {
  id: string;
  label: string;
  provider: ProviderName;
  model: string;
  /** Short hint shown under the label. */
  note?: string;
}

export const CODEGEN_MODELS: CodegenModel[] = [
  { id: 'gemini-pro',        label: 'Gemini 2.5 Pro',     provider: 'gemini',     model: 'gemini-2.5-pro',  note: '사진→형상 최강' },
  { id: 'glm-5.2',           label: 'GLM 5.2',            provider: 'openrouter', model: 'z-ai/glm-5.2',    note: 'OpenRouter · 추론' },
  { id: 'qwen-max',          label: 'Qwen3 Max',          provider: 'openrouter', model: 'qwen/qwen3-max',  note: 'OpenRouter' },
  { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner',  provider: 'deepseek',   model: 'deepseek-reasoner', note: '직접' },
];

export const DEFAULT_CODEGEN_MODEL = 'gemini-pro';

/** Map a (possibly client-supplied) model id to a provider + model, defaulting
 *  safely. Returns the preferred provider (chain keeps fallback behind it). */
export function resolveCodegenModel(id?: string): { preferProvider: ProviderName; model: string; id: string } {
  const m = CODEGEN_MODELS.find(x => x.id === id)
    ?? CODEGEN_MODELS.find(x => x.id === DEFAULT_CODEGEN_MODEL)!;
  return { preferProvider: m.provider, model: m.model, id: m.id };
}
