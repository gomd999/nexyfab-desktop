import { describe, it, expect } from 'vitest';
import {
  createManager,
  addInstance,
  removeInstance,
  renameInstance,
  getInstancesOf,
  whereUsed,
  countByPart,
  addInstances,
  removeAllOfPart,
  summarize,
} from './instanceManager';

describe('addInstance', () => {
  it('creates unique instance id', () => {
    const state = createManager();
    const a = addInstance(state, 'PN-1');
    const b = addInstance(state, 'PN-1');
    expect(a.instanceId).not.toBe(b.instanceId);
  });

  it('instance id starts at 1', () => {
    const state = createManager();
    const a = addInstance(state, 'PN-1');
    expect(a.instanceId).toBe('PN-1-1');
  });

  it('passes name through', () => {
    const state = createManager();
    const a = addInstance(state, 'PN-1', { name: 'Cover Bolt' });
    expect(a.name).toBe('Cover Bolt');
  });

  it('parentAssemblyId preserved', () => {
    const state = createManager();
    const a = addInstance(state, 'PN-1', { parentAssemblyId: 'ASM-1' });
    expect(a.parentAssemblyId).toBe('ASM-1');
  });
});

describe('removeInstance', () => {
  it('returns true when removed', () => {
    const state = createManager();
    const a = addInstance(state, 'PN-1');
    expect(removeInstance(state, a.instanceId)).toBe(true);
  });

  it('returns false for unknown id', () => {
    expect(removeInstance(createManager(), 'ghost')).toBe(false);
  });

  it('removed instance no longer found', () => {
    const state = createManager();
    const a = addInstance(state, 'PN-1');
    removeInstance(state, a.instanceId);
    expect(state.instances.has(a.instanceId)).toBe(false);
  });

  it('partIndex cleaned when last instance removed', () => {
    const state = createManager();
    const a = addInstance(state, 'PN-1');
    removeInstance(state, a.instanceId);
    expect(state.partIndex.has('PN-1')).toBe(false);
  });
});

describe('renameInstance', () => {
  it('updates name', () => {
    const state = createManager();
    const a = addInstance(state, 'PN-1');
    renameInstance(state, a.instanceId, 'New Name');
    expect(state.instances.get(a.instanceId)?.name).toBe('New Name');
  });
});

describe('getInstancesOf', () => {
  it('returns all instances of a part', () => {
    const state = createManager();
    addInstance(state, 'PN-1');
    addInstance(state, 'PN-1');
    addInstance(state, 'PN-2');
    expect(getInstancesOf(state, 'PN-1')).toHaveLength(2);
  });

  it('empty for unknown part', () => {
    expect(getInstancesOf(createManager(), 'ghost')).toEqual([]);
  });
});

describe('whereUsed', () => {
  it('returns parent assembly ids', () => {
    const state = createManager();
    addInstance(state, 'PN-1', { parentAssemblyId: 'ASM-1' });
    addInstance(state, 'PN-1', { parentAssemblyId: 'ASM-2' });
    expect(whereUsed(state, 'PN-1').sort()).toEqual(['ASM-1', 'ASM-2']);
  });

  it('empty when no parent', () => {
    const state = createManager();
    addInstance(state, 'PN-1');
    expect(whereUsed(state, 'PN-1')).toEqual([]);
  });
});

describe('countByPart', () => {
  it('counts instances per part', () => {
    const state = createManager();
    addInstances(state, 'PN-1', 3);
    addInstances(state, 'PN-2', 2);
    const counts = countByPart(state);
    expect(counts.get('PN-1')).toBe(3);
    expect(counts.get('PN-2')).toBe(2);
  });
});

describe('addInstances + removeAllOfPart', () => {
  it('addInstances creates N instances', () => {
    const state = createManager();
    const list = addInstances(state, 'PN-1', 5);
    expect(list).toHaveLength(5);
  });

  it('removeAllOfPart removes all', () => {
    const state = createManager();
    addInstances(state, 'PN-1', 4);
    const removed = removeAllOfPart(state, 'PN-1');
    expect(removed).toBe(4);
    expect(getInstancesOf(state, 'PN-1')).toEqual([]);
  });
});

describe('summarize', () => {
  it('empty', () => {
    const s = summarize(createManager());
    expect(s.totalInstances).toBe(0);
  });

  it('reports counts + most-instanced part', () => {
    const state = createManager();
    addInstances(state, 'PN-1', 5);
    addInstances(state, 'PN-2', 2);
    const s = summarize(state);
    expect(s.totalInstances).toBe(7);
    expect(s.uniqueParts).toBe(2);
    expect(s.mostInstancedPart).toBe('PN-1');
  });

  it('average instances per part', () => {
    const state = createManager();
    addInstances(state, 'PN-1', 4);
    addInstances(state, 'PN-2', 2);
    const s = summarize(state);
    expect(s.averageInstancesPerPart).toBe(3);
  });
});
