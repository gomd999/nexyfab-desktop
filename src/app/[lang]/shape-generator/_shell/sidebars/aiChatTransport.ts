import type { PrecisionCadAgentTask } from '@/lib/ai/precisionCadAgentTask';
import type { AgentSession } from '@/lib/ai/scad-agent/types';

export const SCAD_AGENT_ENDPOINT = '/api/nexyfab/scad-agent/';

export type ScadAgentExecutionMode = 'ai_design' | 'precision_cad';

export interface ScadAgentRequestBody {
  userPrompt: string;
  modelId?: string;
  executionMode?: ScadAgentExecutionMode;
  designDomain?: string;
  precisionTask?: PrecisionCadAgentTask;
  /** Server-issued, HMAC-bound continuation; never authored by the browser. */
  session?: AgentSession;
}

export function buildScadAgentBody(
  userPrompt: string,
  modelId?: string,
  executionMode?: ScadAgentExecutionMode,
  designDomain?: string,
  precisionTask?: PrecisionCadAgentTask,
  session?: AgentSession,
): ScadAgentRequestBody {
  return {
    userPrompt,
    ...(modelId ? { modelId } : {}),
    ...(executionMode ? { executionMode } : {}),
    ...(designDomain ? { designDomain } : {}),
    ...(precisionTask ? { precisionTask } : {}),
    ...(session ? { session } : {}),
  };
}

export function precisionCadBootstrapEndpoint(projectId: string): string {
  return `/api/nexyfab/projects/${encodeURIComponent(projectId)}/precision-cad-agent/bootstrap`;
}

export interface AiChatWireEvent {
  type?: string;
  text?: string;
  question?: string;
  message?: string;
  delta?: string;
  diagnostics?: unknown;
  intent?: unknown;
  pattern?: unknown;
  selectedModelId?: string;
  selectedModelLabel?: string;
  textModel?: string;
  visionModel?: string | null;
  visionAutoRouted?: boolean;
  parallelAssistantModel?: string | null;
  parallelAssistantTasks?: string[];
  cacheProfile?: string;
}

export function textFromAgentEvent(payload: AiChatWireEvent): string {
  if (typeof payload.delta === 'string') return payload.delta;
  if (payload.type === 'model_response' && typeof payload.text === 'string') return payload.text;
  if (payload.type === 'awaiting_user' && typeof payload.question === 'string') return payload.question;
  if (payload.type === 'error' && typeof payload.message === 'string') return payload.message;
  return '';
}
