/**
 * sampleAssemblies — unit tests for the Phase 4.A preset library.
 *
 * Every preset must:
 *   1. pass validateAssembly (no floating, ref ids resolve, etc.)
 *   2. carry a FeatureTree entry for every PartInstance.id (so the
 *      geometryResolver never falls through to null for an in-preset ref)
 *   3. expose every mate.a / mate.b refId through the resolver so the
 *      iterativeSolver has something to chew on for every mate.
 *
 * Plus per-preset shape assertions (parts / mates counts, mate kinds) so a
 * future "swap the preset" refactor surfaces the breakage in this file
 * instead of in the e2e test.
 */
import { describe, it, expect } from 'vitest';
import {
  getSampleAssembly,
  SAMPLE_ASSEMBLY_NAMES,
  type SampleAssemblyName,
} from './sampleAssemblies';
import { validateAssembly } from './assemblyState';
import { featureTreeGeometryResolver } from './geometryResolver';
import type { FeatureTree } from '@/lib/cad/featureTree';
import type { MateRef } from './mate';

const ALL_NAMES: ReadonlyArray<SampleAssemblyName> = SAMPLE_ASSEMBLY_NAMES;

describe('sampleAssemblies — preset library', () => {
  it('SAMPLE_ASSEMBLY_NAMES enumerates exactly the 3 Phase 4.A presets', () => {
    expect(new Set(ALL_NAMES)).toEqual(
      new Set(['two-cubes-concentric', 'three-cubes-chain', 'hinge-pair']),
    );
  });

  it.each(ALL_NAMES)('preset %s passes validateAssembly', (name) => {
    const preset = getSampleAssembly(name);
    expect(() => validateAssembly(preset.state)).not.toThrow();
  });

  it.each(ALL_NAMES)(
    'preset %s carries a FeatureTree entry for every part',
    (name) => {
      const preset = getSampleAssembly(name);
      for (const part of preset.state.parts) {
        expect(preset.featureTrees).toHaveProperty(part.id);
        const tree = preset.featureTrees[part.id];
        expect(tree).toBeDefined();
        expect(Array.isArray(tree!.nodes)).toBe(true);
      }
    },
  );

  it.each(ALL_NAMES)(
    'preset %s — geometryResolver resolves every mate.a / mate.b ref',
    (name) => {
      const preset = getSampleAssembly(name);
      const trees = new Map<string, FeatureTree>(
        Object.entries(preset.featureTrees),
      );
      const resolve = featureTreeGeometryResolver(trees);
      const partsById = new Map(preset.state.parts.map((p) => [p.id, p]));
      const checkSide = (ref: MateRef) => {
        const part = partsById.get(ref.partId);
        expect(part, `mate refers to unknown part ${ref.partId}`).toBeDefined();
        const resolved = resolve(ref, part!);
        expect(
          resolved,
          `${name}: resolver returned null for ${ref.partId}#${ref.refId}`,
        ).not.toBeNull();
      };
      for (const mate of preset.state.mates) {
        checkSide(mate.a);
        checkSide(mate.b);
      }
    },
  );

  it('returns fresh DEEP copies on every call (mutating one does not affect the next)', () => {
    const a = getSampleAssembly('two-cubes-concentric');
    const b = getSampleAssembly('two-cubes-concentric');
    expect(a).not.toBe(b);
    expect(a.state).not.toBe(b.state);
    expect(a.featureTrees).not.toBe(b.featureTrees);
  });

  // ── per-preset shape assertions ──────────────────────────────────────────

  describe('two-cubes-concentric', () => {
    it('has 2 parts and 1 concentric mate', () => {
      const { state } = getSampleAssembly('two-cubes-concentric');
      expect(state.parts).toHaveLength(2);
      expect(state.mates).toHaveLength(1);
      expect(state.mates[0]!.kind).toBe('concentric');
    });

    it('exactly one part is fixed (the anchor)', () => {
      const { state } = getSampleAssembly('two-cubes-concentric');
      expect(state.parts.filter((p) => p.fixed)).toHaveLength(1);
    });
  });

  describe('three-cubes-chain', () => {
    it('has 3 parts and 2 concentric mates', () => {
      const { state } = getSampleAssembly('three-cubes-chain');
      expect(state.parts).toHaveLength(3);
      expect(state.mates).toHaveLength(2);
      for (const mate of state.mates) {
        expect(mate.kind).toBe('concentric');
      }
    });

    it('each mate links to a distinct pair of parts', () => {
      const { state } = getSampleAssembly('three-cubes-chain');
      const pairs = state.mates.map((m) => `${m.a.partId}::${m.b.partId}`);
      expect(new Set(pairs).size).toBe(state.mates.length);
    });
  });

  describe('hinge-pair', () => {
    it('has 2 parts and 1 hinge mate', () => {
      const { state } = getSampleAssembly('hinge-pair');
      expect(state.parts).toHaveLength(2);
      expect(state.mates).toHaveLength(1);
      expect(state.mates[0]!.kind).toBe('hinge');
    });

    it('hinge mate uses axis/axis ref kinds (per the mate IR contract)', () => {
      const { state } = getSampleAssembly('hinge-pair');
      const m = state.mates[0]!;
      expect(m.a.refKind).toBe('axis');
      expect(m.b.refKind).toBe('axis');
    });
  });
});
