import { describe, expect, it } from 'vitest';
import { buildScadAgentBody, SCAD_AGENT_ENDPOINT, textFromAgentEvent } from './aiChatTransport';

describe('AI chat transport contract', () => {
  it('uses the trailing-slash production endpoint and route-compatible body', () => {
    expect(SCAD_AGENT_ENDPOINT).toBe('/api/nexyfab/scad-agent/');
    expect(buildScadAgentBody('make a bracket')).toEqual({ userPrompt: 'make a bracket' });
  });

  it('renders the actual SCAD agent SSE event shapes', () => {
    expect(textFromAgentEvent({ type: 'model_response', text: 'working' })).toBe('working');
    expect(textFromAgentEvent({ type: 'awaiting_user', question: 'Which thickness?' })).toBe('Which thickness?');
    expect(textFromAgentEvent({ type: 'error', message: 'provider failed' })).toBe('provider failed');
  });
});
