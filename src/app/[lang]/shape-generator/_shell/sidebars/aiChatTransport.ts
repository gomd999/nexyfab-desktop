export const SCAD_AGENT_ENDPOINT = '/api/nexyfab/scad-agent/';

export function buildScadAgentBody(userPrompt: string): { userPrompt: string } {
  return { userPrompt };
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
}

export function textFromAgentEvent(payload: AiChatWireEvent): string {
  if (typeof payload.delta === 'string') return payload.delta;
  if (payload.type === 'model_response' && typeof payload.text === 'string') return payload.text;
  if (payload.type === 'awaiting_user' && typeof payload.question === 'string') return payload.question;
  if (payload.type === 'error' && typeof payload.message === 'string') return payload.message;
  return '';
}
