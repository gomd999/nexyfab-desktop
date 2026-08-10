import { describe, expect, it } from 'vitest';
import { pinBlockAssemblyPlan } from '@/lib/ai/design-driver/fixturePlanner';
import { buildEditableWorkspaceCandidate } from '@/lib/ai/design-driver/workspaceCandidate';
import {
  readAiAssemblyWorkspaceSeed,
  removeAiAssemblyWorkspaceSeed,
  writeAiAssemblyWorkspaceSeed,
} from './assemblyWorkspaceSeed';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe('AI assembly workspace seed handoff', () => {
  it('round-trips a validated semantic assembly revision and removes it', () => {
    const storage = memoryStorage();
    const candidate = buildEditableWorkspaceCandidate(pinBlockAssemblyPlan());
    expect(writeAiAssemblyWorkspaceSeed('rev-1', candidate, storage)).toEqual({ ok: true });
    expect(readAiAssemblyWorkspaceSeed('rev-1', storage)?.candidate.assembly?.state.mates).toHaveLength(2);
    expect(readAiAssemblyWorkspaceSeed('wrong-revision', storage)).toBeNull();
    removeAiAssemblyWorkspaceSeed('rev-1', storage);
    expect(readAiAssemblyWorkspaceSeed('rev-1', storage)).toBeNull();
  });

  it('refuses a single-part modeler candidate', () => {
    const storage = memoryStorage();
    const candidate = buildEditableWorkspaceCandidate({
      ...pinBlockAssemblyPlan(),
      parts: [pinBlockAssemblyPlan().parts[0]!],
      assembly: undefined,
    });
    const result = writeAiAssemblyWorkspaceSeed('rev-bad', candidate, storage);
    expect(result.ok).toBe(false);
    expect(readAiAssemblyWorkspaceSeed('rev-bad', storage)).toBeNull();
  });
});
