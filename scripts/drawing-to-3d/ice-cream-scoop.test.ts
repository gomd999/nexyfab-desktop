import { describe, expect, it } from 'vitest';
import { composeWithGate, gateComposite, iceCreamScoopIntent } from './compose.mjs';

describe('ice-cream scoop semantic template', () => {
  it('creates an open hemispherical shell instead of a solid cylinder', () => {
    const intent = iceCreamScoopIntent('Ice cream scoop, bowl diameter 55mm, handle diameter 18mm x length 120mm, thickness 2mm');
    expect(intent).not.toBeNull();
    if (!intent) throw new Error('expected deterministic scoop intent');
    expect(intent.productMeta).toMatchObject({
      template: 'ice_cream_scoop_v1', semanticShape: 'open-hemispherical-bowl', bowlDiameterMm: 55, wallThicknessMm: 2,
    });
    const bowl = intent.features[0];
    expect(bowl).toMatchObject({ id: 'hemispherical_bowl', kind: 'revolve' });
    if (!bowl) throw new Error('expected hemispherical bowl feature');
    const profile = 'profile' in bowl && Array.isArray(bowl.profile) ? bowl.profile : [];
    expect(profile.length).toBeGreaterThan(30);
    expect(intent.features.some((feature) => feature.id === 'handle' && feature.kind === 'cylinder')).toBe(true);
    expect(gateComposite(intent)).toEqual([]);
  });

  it('bypasses AI and emits verified scoop geometry for a Korean request', async () => {
    const result = await composeWithGate('아이스크림 스쿱 보우 ϴ55mm, 손잡이 ϴ18x120mm, 두께 2mm');
    expect(result.gatePassed).toBe(true);
    expect(result.intent.productMeta?.template).toBe('ice_cream_scoop_v1');
    expect(result.scad).toContain('rotate_extrude');
    expect(result.scad).toContain('rotate([0,90,0])');
  });
});
