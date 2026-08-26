import { describe, expect, it } from 'vitest';
import {
  AGENTIC_CAD_TOOL_IDS,
  AGENTIC_CAD_TOOL_REGISTRY,
  AGENTIC_CAD_TOOL_REGISTRY_HASH,
  getAgenticCadToolDescriptor,
  hashAgenticCadToolRegistry,
  validateAgenticCadToolRegistry,
} from './agenticCadToolRegistry';

describe('GP-07 agentic CAD tool registry', () => {
  it('is complete, versioned, deterministic and immutable', () => {
    expect(validateAgenticCadToolRegistry(AGENTIC_CAD_TOOL_REGISTRY)).toEqual([]);
    expect(AGENTIC_CAD_TOOL_REGISTRY.entries.map(entry => entry.toolId)).toEqual(AGENTIC_CAD_TOOL_IDS);
    expect(hashAgenticCadToolRegistry(AGENTIC_CAD_TOOL_REGISTRY.entries)).toBe(AGENTIC_CAD_TOOL_REGISTRY_HASH);
    expect(Object.isFrozen(AGENTIC_CAD_TOOL_REGISTRY)).toBe(true);
    expect(Object.isFrozen(AGENTIC_CAD_TOOL_REGISTRY.entries[0]?.resourceBudget)).toBe(true);
  });

  it('keeps queries R0, previews R1 and commits R3 with human approval', () => {
    expect(getAgenticCadToolDescriptor('project.inspect')).toMatchObject({
      riskClass: 'R0', executionMode: 'QUERY', sideEffect: 'NONE', approvalPolicy: 'NONE',
    });
    expect(getAgenticCadToolDescriptor('feature.preview')).toMatchObject({
      riskClass: 'R1', executionMode: 'SANDBOX', sideEffect: 'NONE', approvalPolicy: 'NONE',
    });
    expect(getAgenticCadToolDescriptor('feature.commit')).toMatchObject({
      riskClass: 'R3', executionMode: 'AUTHORITATIVE', sideEffect: 'CANONICAL_MUTATION', approvalPolicy: 'HUMAN_REQUIRED',
    });
    expect(getAgenticCadToolDescriptor('release.publish')).toBeNull();
    expect(getAgenticCadToolDescriptor('quote.create')).toBeNull();
  });

  it('returns clone-safe descriptors', () => {
    const first = getAgenticCadToolDescriptor('feature.commit')!;
    first.resourceBudget.timeoutMs = 1;
    expect(getAgenticCadToolDescriptor('feature.commit')?.resourceBudget.timeoutMs).toBe(60_000);
  });

  it('rejects policy promotion, missing coverage, duplicates and hash tampering', () => {
    const promoted = structuredClone(AGENTIC_CAD_TOOL_REGISTRY);
    promoted.entries[0]!.riskClass = 'R3';
    promoted.registryHash = hashAgenticCadToolRegistry(promoted.entries);
    expect(validateAgenticCadToolRegistry(promoted)).toContain('entries[0]:queryPolicy');

    const missingEntries = structuredClone([...AGENTIC_CAD_TOOL_REGISTRY.entries]);
    missingEntries.pop();
    const missing = {
      ...structuredClone(AGENTIC_CAD_TOOL_REGISTRY),
      entries: missingEntries,
      registryHash: hashAgenticCadToolRegistry(missingEntries),
    };
    expect(validateAgenticCadToolRegistry(missing)).toContain('registry:missing:qualification.evaluate');

    const duplicate = structuredClone(AGENTIC_CAD_TOOL_REGISTRY);
    duplicate.entries[1]!.toolId = duplicate.entries[0]!.toolId;
    duplicate.registryHash = hashAgenticCadToolRegistry(duplicate.entries);
    expect(validateAgenticCadToolRegistry(duplicate)).toEqual(expect.arrayContaining(['registry:duplicateToolId', 'registry:missing:document.query']));

    expect(validateAgenticCadToolRegistry({ ...AGENTIC_CAD_TOOL_REGISTRY, registryHash: '0'.repeat(64) })).toContain('registry:hashMismatch');
  });

  it('fails closed without throwing on getters, proxies and unknown keys', () => {
    const getter = Object.create(Object.prototype);
    Object.defineProperty(getter, 'schema', { enumerable: true, get: () => { throw new Error('boom'); } });
    expect(() => validateAgenticCadToolRegistry(getter)).not.toThrow();
    expect(validateAgenticCadToolRegistry(getter)).toEqual(['registry:keys']);

    const hostile = new Proxy({}, { ownKeys: () => { throw new Error('boom'); } });
    expect(validateAgenticCadToolRegistry(hostile)).toEqual(['registry:unreadable']);
    expect(validateAgenticCadToolRegistry({ ...AGENTIC_CAD_TOOL_REGISTRY, unexpected: true })).toEqual(['registry:keys']);
  });
});
