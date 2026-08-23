import { describe, expect, it } from 'vitest';

describe('assembly placement repair', () => {
  it('reduces a verified overlap without changing part dimensions', async () => {
    const mod = await import('./edit-assembly.mjs') as typeof import('./edit-assembly.mjs');
    const assembly = {
      parts: [
        { id: 'base', type: 'box', params: { width: 100, depth: 100, height: 10 }, at: { tx: 0, ty: 0, tz: 0 } },
        { id: 'block', type: 'box', params: { width: 20, depth: 20, height: 20 }, at: { tx: 10, ty: 10, tz: 2 } },
      ],
    };
    const result = mod.repairAssemblyDeterministic(assembly);
    expect(result.ok).toBe(true);
    const success = result as typeof result & {
      beforeInterferences: number;
      remainingInterferences: number;
      assembly: typeof assembly;
    };
    expect(success.beforeInterferences).toBeGreaterThan(0);
    expect(success.remainingInterferences).toBeLessThan(success.beforeInterferences);
    expect(success.assembly.parts[1].params).toEqual(assembly.parts[1].params);
  });

  it('rejects geometry and unknown-id fields in placement patches', async () => {
    const mod = await import('./edit-assembly.mjs') as typeof import('./edit-assembly.mjs');
    const assembly = {
      parts: [
        { id: 'a', type: 'box', params: { width: 10, depth: 10, height: 10 }, at: { tx: 0, ty: 0, tz: 0 } },
        { id: 'b', type: 'box', params: { width: 10, depth: 10, height: 10 }, at: { tx: 20, ty: 0, tz: 0 } },
      ],
    };
    const result = mod.applyAssemblyPlacements(assembly, [
      { id: 'missing', at: { tx: 1 } },
      { id: 'a', at: { tx: 5, width: 999 }, params: { width: 999 } },
    ]);
    expect(result.ok).toBe(true);
    expect(result.assembly.parts[0].at.tx).toBe(5);
    expect(result.assembly.parts[0].at.width).toBeUndefined();
    expect(result.assembly.parts[0].params.width).toBe(10);
  });

  it('rebuilds a legacy jet proxy instead of pretending placement can repair its topology', async () => {
    const mod = await import('./edit-assembly.mjs') as typeof import('./edit-assembly.mjs');
    const legacy = {
      name: '터보제트 엔진 조립체',
      parts: [
        { id: 'compressor_disc_1', type: 'cylinder', params: { diameter: 500, length: 20 }, at: { tx: 0, ty: 0, tz: 0 } },
        { id: 'compressor_casing', type: 'cylinder', params: { diameter: 500, length: 400 }, at: { tx: 0, ty: 0, tz: 0 } },
        { id: 'annular_combustion_chamber', type: 'cylinder', params: { diameter: 350, length: 300 }, at: { tx: 0, ty: 0, tz: 0 } },
        { id: 'turbine_disc_1', type: 'cylinder', params: { diameter: 250, length: 20 }, at: { tx: 0, ty: 0, tz: 0 } },
        { id: 'outer_casing', type: 'cylinder', params: { diameter: 500, length: 1500 }, at: { tx: 0, ty: 0, tz: 0 } },
      ],
    };
    const result = await mod.repairAssemblyWithAi(legacy, '간섭을 해결해줘');
    expect(result).toMatchObject({ ok: true, legacyProxyRebuilt: true, code: 'LEGACY_JET_PROXY_REBUILT', remainingInterferences: 0 });
    expect('assembly' in result).toBe(true);
    if (!('assembly' in result)) throw new Error('expected upgraded assembly');
    expect(result.assembly.parts.some((part: { gen?: { kind?: string } }) => part.gen?.kind === 'blade_ring')).toBe(true);
    expect(result.assembly.parts.some((part: { id?: string }) => part.id === 'annular_combustor_liner')).toBe(true);
  });
});
