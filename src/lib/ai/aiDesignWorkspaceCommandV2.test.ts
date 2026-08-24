import { describe, expect, it } from 'vitest';
import { clientCommandToRuntimeAction, isAiDesignWorkspaceClientCommandV2, isAiDesignWorkspaceServerCommandV2, parseAiDesignWorkspaceClientCommandV2 } from './aiDesignWorkspaceCommandV2';

const base = { schema: 'nexyfab.ai-design-workspace-command.v2', commandId: 'cmd:1', projectId: 'p1', sessionId: 's1', expectedRuntimeRevision: 0, issuedAt: '2026-08-24T00:00:00.000Z' } as const;
describe('AiDesignWorkspaceCommandV2', () => {
  it('parses bounded client requests and maps safe view actions', () => {
    const result = parseAiDesignWorkspaceClientCommandV2({ ...base, type: 'ADJUST_GAUGE', payload: { gaugeId: 'g1', mode: 'fine', direction: 1 } });
    expect(result.ok).toBe(true);
    if (result.ok) expect(clientCommandToRuntimeAction(result.command)).toMatchObject({ type: 'ADJUST_GAUGE', expectedRevision: 0, actionId: 'cmd:1' });
  });
  it('fails closed for unknown authority claims and server-only completions', () => {
    expect(parseAiDesignWorkspaceClientCommandV2({ ...base, type: 'PUBLISH_CANDIDATES', payload: { artifactId: 'a', evidence: { status: 'PASS' } } }).ok).toBe(false);
    expect(parseAiDesignWorkspaceClientCommandV2({ ...base, type: 'SELECT_CANDIDATE', payload: { candidateId: 'c', providerModelId: 'runtime-x' } }).ok).toBe(false);
    expect(parseAiDesignWorkspaceClientCommandV2({ ...base, type: 'START_GENERATION_REQUEST', payload: { runId: 'r1', modelSelection: { mode: 'auto', plan: 'enterprise' } } }).ok).toBe(false);
    expect(isAiDesignWorkspaceServerCommandV2({ ...base, schema: 'nexyfab.ai-design-workspace-server-command.v2', source: 'server', type: 'CANDIDATES_PUBLISHED', payload: { artifactId: 'a', artifactDigest: 'x', evidenceDigest: 'y' } })).toBe(true);
  });
  it('does not turn understanding or generation requests into authoritative runtime transitions', () => {
    const understanding = parseAiDesignWorkspaceClientCommandV2({ ...base, type: 'REQUEST_UNDERSTANDING_CONFIRMATION', payload: { acknowledged: true } });
    const generation = parseAiDesignWorkspaceClientCommandV2({ ...base, type: 'START_GENERATION_REQUEST', payload: { runId: 'run:1', modelSelection: { mode: 'auto' } } });
    expect(understanding.ok && clientCommandToRuntimeAction(understanding.command)).toBeNull();
    expect(generation.ok && clientCommandToRuntimeAction(generation.command)).toBeNull();
  });
  it('rejects malformed and oversized nested payloads', () => {
    expect(isAiDesignWorkspaceClientCommandV2({ ...base, type: 'CANCEL', payload: { reason: 'x', extra: true } })).toBe(false);
    expect(isAiDesignWorkspaceClientCommandV2({ ...base, type: 'INGEST_INPUTS', payload: { inputs: [] } })).toBe(false);
    expect(isAiDesignWorkspaceClientCommandV2({ ...base, type: 'SELECT_CANDIDATE', payload: { candidateId: 'x', nested: { evidence: 'PASS' } } })).toBe(false);
  });
});
