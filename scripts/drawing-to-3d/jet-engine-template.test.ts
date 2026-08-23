import { describe, expect, it } from 'vitest';
import { buildAssembly } from './assembly.mjs';
import { buildTurbojetConceptAssembly, inferJetEngineTemplate, legacyJetEnvelope, looksLikeLegacyJetProxy } from './jet-engine-template.mjs';

describe('turbojet concept template', () => {
  it('routes Korean jet-engine requests and preserves explicit envelope inputs', () => {
    const inferred = inferJetEngineTemplate('팬 직경 500mm, 전체 길이 1500mm, 케이싱 두께 3mm인 5단 압축기와 2단 터빈 제트엔진');
    expect(inferred?.template).toMatchObject({
      domain: 'mech', id: 'turbojet_concept',
      params: { fanDiameter: 500, overallLength: 1500, casingThickness: 3, compressorStages: 5, turbineStages: 2 },
    });
  });

  it('builds real blade meshes, annular combustor and a clash-free axial flow path', () => {
    const assembly = buildTurbojetConceptAssembly({
      fanDiameter: 500, overallLength: 1500, casingThickness: 3,
      compressorStages: 5, compressorBlades: 12, turbineStages: 2, turbineBlades: 10,
    });
    const built = buildAssembly(assembly);
    expect(built.ok).toBe(true);
    expect(built.gateErrors).toEqual([]);
    expect(built.interferences).toEqual([]);
    expect(assembly.parts.filter((part) => part.type === 'mesh')).toHaveLength(8);
    const rotor = assembly.parts.find((part) => part.id === 'compressor_rotor_1') as { params?: { verts?: unknown[] } } | undefined;
    expect(rotor?.params?.verts?.length).toBeGreaterThan(1000);
    expect(assembly.parts.find((part) => part.id === 'annular_combustor_liner')).toMatchObject({ type: 'tube', system: '환형 연소기' });
    expect(assembly.jetEngineMeta.analysisLevel).toBe('preliminary-1D-geometry');
    expect(assembly.jetEngineMeta.notVerified).toContain('CFD pressure/temperature field');
    expect(built.structural).toBeNull();
  });

  it('recognizes the former primitive proxy and recovers its broad envelope', () => {
    const legacy = {
      name: '터보제트 엔진 조립체',
      parts: [
        { id: 'compressor_disc_1', type: 'cylinder', params: { diameter: 500, length: 20 } },
        { id: 'compressor_casing', type: 'cylinder', params: { diameter: 500, length: 400 } },
        { id: 'annular_combustion_chamber', type: 'cylinder', params: { diameter: 350, length: 300 } },
        { id: 'turbine_disc_1', type: 'cylinder', params: { diameter: 250, length: 20 } },
        { id: 'outer_casing', type: 'cylinder', params: { diameter: 500, length: 1500 } },
      ],
    };
    expect(looksLikeLegacyJetProxy(legacy)).toBe(true);
    expect(legacyJetEnvelope(legacy)).toMatchObject({ fanDiameter: 500, overallLength: 1500 });
  });
});
