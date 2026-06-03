/**
 * configurations — apply / resolve / validate tests (Phase 2.6.4, ADR-013).
 */
import { describe, it, expect } from 'vitest';
import {
  validateConfigurationSet,
  applyConfiguration,
  resolveActive,
  type Configuration,
  type ConfigurationSet,
} from './configurations';
import type { ExtrudeFeature } from './extrudeProfile';
import type { FeatureTree, FeatureNode } from './featureTree';

function extrudeNode(id: string, name: string, depth = 3): FeatureNode {
  const payload: ExtrudeFeature = {
    kind: 'extrude',
    loop: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }],
    depth,
    direction: 'one_sided',
    mode: 'add',
  };
  return { id, name, dependencies: [], payload };
}

function baseTree(): FeatureTree {
  return {
    nodes: [
      extrudeNode('base', 'Base', 3),
      extrudeNode('rib', 'Rib', 7),
    ],
  };
}

// ─── applyConfiguration ─────────────────────────────────────────────────────

describe('applyConfiguration', () => {
  it('suppresses the named nodes and leaves others untouched', () => {
    const config: Configuration = { name: 'no-rib', suppress: ['rib'] };
    const out = applyConfiguration(baseTree(), config);
    const byId = new Map(out.nodes.map((n) => [n.id, n]));
    expect(byId.get('rib')!.suppressed).toBe(true);
    expect(byId.get('base')!.suppressed).toBeUndefined();
  });

  it('overrides a numeric payload field via shallow merge', () => {
    const config: Configuration = {
      name: 'tall',
      paramOverrides: { base: { depth: 12 } },
    };
    const out = applyConfiguration(baseTree(), config);
    const base = out.nodes.find((n) => n.id === 'base')!;
    expect((base.payload as ExtrudeFeature).depth).toBe(12);
    // Untouched fields survive the shallow merge.
    expect(base.payload.kind).toBe('extrude');
    expect((base.payload as ExtrudeFeature).mode).toBe('add');
  });

  it('does not mutate the original tree, nodes, or payloads', () => {
    const tree = baseTree();
    const originalDepth = (tree.nodes[0]!.payload as ExtrudeFeature).depth;
    const config: Configuration = {
      name: 'variant',
      suppress: ['rib'],
      paramOverrides: { base: { depth: 99 } },
    };
    applyConfiguration(tree, config);
    expect((tree.nodes[0]!.payload as ExtrudeFeature).depth).toBe(originalDepth);
    expect(tree.nodes[1]!.suppressed).toBeUndefined();
  });

  it('treats a config with no fields as a no-op (same node references)', () => {
    const tree = baseTree();
    const out = applyConfiguration(tree, { name: 'default' });
    expect(out.nodes[0]).toBe(tree.nodes[0]);
    expect(out.nodes[1]).toBe(tree.nodes[1]);
  });

  it('ignores unknown node ids at apply time', () => {
    const tree = baseTree();
    const config: Configuration = {
      name: 'stray',
      suppress: ['ghost'],
      paramOverrides: { phantom: { depth: 1 } },
    };
    const out = applyConfiguration(tree, config);
    expect(out.nodes.map((n) => n.id)).toEqual(['base', 'rib']);
    expect(out.nodes.every((n) => n.suppressed === undefined)).toBe(true);
  });
});

// ─── resolveActive ──────────────────────────────────────────────────────────

describe('resolveActive', () => {
  it('applies the active configuration from the set', () => {
    const set: ConfigurationSet = {
      active: 'tall',
      configs: [
        { name: 'default' },
        { name: 'tall', paramOverrides: { base: { depth: 20 } } },
      ],
    };
    const out = resolveActive(baseTree(), set);
    expect((out.nodes.find((n) => n.id === 'base')!.payload as ExtrudeFeature).depth).toBe(20);
  });

  it('throws when the active configuration is missing', () => {
    const set: ConfigurationSet = { active: 'nope', configs: [{ name: 'default' }] };
    expect(() => resolveActive(baseTree(), set)).toThrow(/not found/);
  });
});

// ─── validateConfigurationSet ───────────────────────────────────────────────

describe('validateConfigurationSet', () => {
  it('accepts a well-formed set', () => {
    const set: ConfigurationSet = {
      active: 'a',
      configs: [
        { name: 'a', suppress: ['rib'], paramOverrides: { base: { depth: 5 } } },
        { name: 'b' },
      ],
    };
    const res = validateConfigurationSet(baseTree(), set);
    expect(res.ok).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it('rejects duplicate config names', () => {
    const set: ConfigurationSet = {
      active: 'a',
      configs: [{ name: 'a' }, { name: 'a' }],
    };
    const res = validateConfigurationSet(baseTree(), set);
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => /duplicate/.test(e))).toBe(true);
  });

  it('rejects empty config names', () => {
    const set: ConfigurationSet = { active: '', configs: [{ name: '' }] };
    const res = validateConfigurationSet(baseTree(), set);
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => /empty name/.test(e))).toBe(true);
  });

  it('rejects a missing active configuration', () => {
    const set: ConfigurationSet = { active: 'ghost', configs: [{ name: 'a' }] };
    const res = validateConfigurationSet(baseTree(), set);
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => /active configuration ghost/.test(e))).toBe(true);
  });

  it('rejects unknown node ids in suppress and overrides', () => {
    const set: ConfigurationSet = {
      active: 'a',
      configs: [
        { name: 'a', suppress: ['nope'], paramOverrides: { alsoNope: { depth: 1 } } },
      ],
    };
    const res = validateConfigurationSet(baseTree(), set);
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => /suppresses unknown node id: nope/.test(e))).toBe(true);
    expect(res.errors.some((e) => /overrides unknown node id: alsoNope/.test(e))).toBe(true);
  });
});
