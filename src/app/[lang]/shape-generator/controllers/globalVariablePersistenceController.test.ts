import { describe, expect, it, vi } from 'vitest';

import {
  createGlobalVariableRestoreSeeds,
  createGlobalVariableSnapshot,
} from './globalVariablePersistenceController';

describe('GP-08 global variable persistence controller', () => {
  it('persists only names and raw expressions', () => {
    expect(createGlobalVariableSnapshot([
      { id: 'runtime-1', name: 'W', expression: '80', value: 80 },
      { id: 'runtime-2', name: 'ratio', expression: 'W/2', value: 40 },
    ])).toEqual([
      { name: 'W', expression: '80' },
      { name: 'ratio', expression: 'W/2' },
    ]);
  });

  it('creates deterministic unresolved seeds in source order', () => {
    expect(createGlobalVariableRestoreSeeds([
      { name: 'W', expression: '80' },
      { name: 'ratio', expression: 'W/2' },
    ])).toEqual([
      { id: 'mv-nfab-0-W', name: 'W', expression: '80', value: 0 },
      { id: 'mv-nfab-1-ratio', name: 'ratio', expression: 'W/2', value: 0 },
    ]);
  });

  it('maps missing and malformed collection inputs to an empty table', () => {
    expect(createGlobalVariableSnapshot(undefined)).toEqual([]);
    expect(createGlobalVariableRestoreSeeds(null)).toEqual([]);
    expect(createGlobalVariableRestoreSeeds({ length: 1 })).toEqual([]);
  });

  it('drops malformed rows without renumbering valid source indices', () => {
    expect(createGlobalVariableRestoreSeeds([
      { name: 1, expression: 'bad' },
      { name: 'W', expression: '80' },
    ])).toEqual([
      { id: 'mv-nfab-1-W', name: 'W', expression: '80', value: 0 },
    ]);
  });

  it('does not invoke row getters and fails hostile proxies closed', () => {
    const getter = vi.fn(() => 'W');
    const row = Object.defineProperty({ expression: '80' }, 'name', {
      enumerable: true,
      get: getter,
    });
    expect(createGlobalVariableSnapshot([row])).toEqual([]);
    expect(getter).not.toHaveBeenCalled();

    const hostile = new Proxy({}, {
      getPrototypeOf() {
        throw new Error('hostile proxy');
      },
    });
    expect(createGlobalVariableRestoreSeeds([hostile])).toEqual([]);
  });

  it('returns detached values', () => {
    const source = [{ name: 'W', expression: '80' }];
    const snapshot = createGlobalVariableSnapshot(source);
    source[0].expression = '90';
    expect(snapshot).toEqual([{ name: 'W', expression: '80' }]);
  });
});
