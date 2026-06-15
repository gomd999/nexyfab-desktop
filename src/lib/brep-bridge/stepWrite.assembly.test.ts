/**
 * stepWrite.assembly — multi-part assembly STEP writer tests.
 *
 * Companion to stepWrite.test.ts; covers `writeAssemblyAsStep` which is the
 * Phase 2 hook for emitting NEXT_ASSEMBLY_USAGE_OCCURRENCE entries alongside
 * one PRODUCT_DEFINITION per child part.
 *
 * Still BOX-only — see ./stepWrite.ts module JSDoc for limitations.
 */
import { describe, it, expect } from 'vitest';
import {
  writeAssemblyAsStep,
  type AssemblyStepInput,
} from './stepWrite';

function twoBoxAssembly(): AssemblyStepInput {
  return {
    assemblyName: 'gearbox-asm',
    parts: [
      { id: 'housing', name: 'housing', x0: 0, y0: 0, z0: 0, x1: 50, y1: 50, z1: 20 },
      { id: 'shaft', name: 'shaft', x0: 5, y0: 5, z0: 0, x1: 15, y1: 15, z1: 40 },
    ],
  };
}

describe('writeAssemblyAsStep', () => {
  it('produces a complete STEP file with header + data + trailer', () => {
    const out = writeAssemblyAsStep(twoBoxAssembly());
    expect(out.startsWith('ISO-10303-21;')).toBe(true);
    expect(out).toContain('HEADER;');
    expect(out).toContain('DATA;');
    expect(out.trimEnd().endsWith('END-ISO-10303-21;')).toBe(true);
  });

  it('emits one PRODUCT_DEFINITION per part plus one for the assembly', () => {
    const out = writeAssemblyAsStep(twoBoxAssembly());
    // PRODUCT_DEFINITION lines (not PRODUCT_DEFINITION_FORMATION_*, _CONTEXT, _SHAPE).
    const pdefMatches = out.match(/PRODUCT_DEFINITION\(' '/g) ?? [];
    // 1 assembly + 2 parts = 3.
    expect(pdefMatches.length).toBe(3);
  });

  it('emits one NEXT_ASSEMBLY_USAGE_OCCURRENCE per child part', () => {
    const out = writeAssemblyAsStep(twoBoxAssembly());
    const nauo = out.match(/NEXT_ASSEMBLY_USAGE_OCCURRENCE\(/g) ?? [];
    expect(nauo.length).toBe(2);
  });

  it('uses the part id as the NAUO id', () => {
    const out = writeAssemblyAsStep(twoBoxAssembly());
    expect(out).toMatch(/NEXT_ASSEMBLY_USAGE_OCCURRENCE\('housing','housing'/);
    expect(out).toMatch(/NEXT_ASSEMBLY_USAGE_OCCURRENCE\('shaft','shaft'/);
  });

  it('emits a MANIFOLD_SOLID_BREP for every part', () => {
    const out = writeAssemblyAsStep(twoBoxAssembly());
    const breps = out.match(/MANIFOLD_SOLID_BREP/g) ?? [];
    expect(breps.length).toBe(2);
  });

  it('every #N reference resolves to a defined entity', () => {
    const out = writeAssemblyAsStep(twoBoxAssembly());
    const defined = new Set<number>();
    for (const m of out.matchAll(/^#(\d+)=/gm)) defined.add(Number(m[1]));
    expect(defined.size).toBeGreaterThan(0);

    const dataSection = out.slice(out.indexOf('DATA;'));
    for (const m of dataSection.matchAll(/#(\d+)/g)) {
      const ref = Number(m[1]);
      expect(defined.has(ref)).toBe(true);
    }
  });

  it('throws on duplicate part ids', () => {
    expect(() =>
      writeAssemblyAsStep({
        assemblyName: 'asm',
        parts: [
          { id: 'dup', name: 'a', x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1 },
          { id: 'dup', name: 'b', x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1 },
        ],
      }),
    ).toThrow(/duplicate part id/);
  });

  it('throws on empty parts list', () => {
    expect(() =>
      writeAssemblyAsStep({ assemblyName: 'asm', parts: [] }),
    ).toThrow(/at least one part/);
  });

  it('threads header options through to the file header', () => {
    const out = writeAssemblyAsStep(twoBoxAssembly(), {
      authorName: 'NexyFab CI',
      organization: 'NexyFab QA',
      description: 'gearbox assembly test',
    });
    expect(out).toContain('NexyFab CI');
    expect(out).toContain('NexyFab QA');
    expect(out).toContain('gearbox assembly test');
  });
});
