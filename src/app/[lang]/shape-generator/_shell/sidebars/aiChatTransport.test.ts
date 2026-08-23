import { describe, expect, it } from 'vitest';
import { buildScadAgentBody, precisionCadBootstrapEndpoint, SCAD_AGENT_ENDPOINT, textFromAgentEvent } from './aiChatTransport';

describe('AI chat transport contract', () => {
  it('uses the trailing-slash production endpoint and route-compatible body', () => {
    expect(SCAD_AGENT_ENDPOINT).toBe('/api/nexyfab/scad-agent/');
    expect(buildScadAgentBody('make a bracket')).toEqual({ userPrompt: 'make a bracket' });
    expect(buildScadAgentBody('refine this part', 'gpt-5.6-sol', 'precision_cad', 'mechanical')).toEqual({
      userPrompt: 'refine this part',
      modelId: 'gpt-5.6-sol',
      executionMode: 'precision_cad',
      designDomain: 'mechanical',
    });
  });

  it('renders the actual SCAD agent SSE event shapes', () => {
    expect(textFromAgentEvent({ type: 'model_response', text: 'working' })).toBe('working');
    expect(textFromAgentEvent({ type: 'awaiting_user', question: 'Which thickness?' })).toBe('Which thickness?');
    expect(textFromAgentEvent({ type: 'error', message: 'provider failed' })).toBe('provider failed');
  });

  it('carries only the server-issued continuation and targets the project bootstrap route', () => {
    const session = { id: 'server-session' } as never;
    expect(buildScadAgentBody('edit', undefined, 'precision_cad', 'mechanical', undefined, session)).toMatchObject({ session });
    expect(precisionCadBootstrapEndpoint('project/one')).toBe('/api/nexyfab/projects/project%2Fone/precision-cad-agent/bootstrap');
  });
});
