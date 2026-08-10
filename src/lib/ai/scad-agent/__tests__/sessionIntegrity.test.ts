import { beforeEach, describe, expect, it } from 'vitest';
import { signAgentSession, verifyAgentSession } from '../sessionIntegrity';
import type { AgentSession } from '../types';

function session(): AgentSession {
  return {
    id: 'agent-test', scadSource: 'cube(10);', modules: {}, composition: null,
    designPlan: null, checkpoints: [], brepEntries: [], sketches: {}, mates: [],
    gdtFrames: [], docRefs: [], history: [], render: { ok: null, errors: [] },
    geometry: {}, budget: {
      tokensUsed: 0, tokensCap: 100, turnsUsed: 0, turnsCap: 2,
      toolCallsUsed: 0, toolCallsCap: 2, visionCallsUsed: 0, visionCallsCap: 0,
      consecutiveRenderFails: 0,
    }, status: 'idle',
  };
}

describe('SCAD agent session integrity', () => {
  beforeEach(() => { process.env.SCAD_AGENT_SESSION_SECRET = 'test-agent-secret-at-least-32-characters'; });

  it('binds the complete session to one authenticated user', () => {
    const value = signAgentSession(session(), 'user-a');
    expect(verifyAgentSession(value, 'user-a')).toBe(true);
    expect(verifyAgentSession(value, 'user-b')).toBe(false);
  });

  it('rejects client-side geometry and history tampering', () => {
    const value = signAgentSession(session(), 'user-a');
    value.brepEntries.push({ handle: 'occt:999', kind: 'forged', ts: Date.now() });
    expect(verifyAgentSession(value, 'user-a')).toBe(false);
  });

  it('rejects unsigned legacy sessions without deleting their client data', () => {
    expect(verifyAgentSession(session(), 'user-a')).toBe(false);
  });
});
