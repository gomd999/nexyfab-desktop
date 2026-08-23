import { describe, expect, it } from 'vitest';
import { createLinearArrayDefaults, type HoleArrayDefinition } from './holeArray';
import { holeArrayToFeaturePlacements } from './holeWizardRuntime';

function baseDef(): HoleArrayDefinition {
  return {
    ...createLinearArrayDefaults('holes', { series: 'ISO', designation: 'M6', fitClass: 'normal' }),
    holeSpecDetail: { kind: 'counterdrill', diameter: 5, headDiameter: 12, headDepth: 3, middleDiameter: 8, middleDepth: 6, drillTipAngle: 118 },
    terminationKind: 'blind',
    terminationParams: { kind: 'blind', depth: 20 },
  };
}

describe('holeArrayToFeaturePlacements', () => {
  it('expands an array and retains advanced counterdrill geometry', () => {
    const def = baseDef();
    def.params = { kind: 'linear', data: { startX: 0, startY: 0, dx: 10, dy: 0, count: 3 } };
    const placements = holeArrayToFeaturePlacements(def);
    expect(placements).toHaveLength(3);
    expect(placements[1]?.params).toMatchObject({
      holeType: 3,
      diameter: 5,
      counterboreDia: 12,
      middleDiameter: 8,
      middleDepth: 6,
      endCondition: 0,
      depth: 20,
    });
  });

  it('maps pipe-tap taper and up-to-next without silently downgrading either', () => {
    const def = baseDef();
    def.holeSpecDetail = { kind: 'pipe_tap', diameter: 11.2, pipeStandard: 'NPT', pipeSizeKey: '1/4-18', engagementDepth: 14, taperAngle: 1.7833 };
    def.terminationKind = 'upToNext';
    def.terminationParams = { kind: 'upToNext' };
    const [placement] = holeArrayToFeaturePlacements(def);
    expect(placement?.params).toMatchObject({ holeType: 5, taperAngle: 1.7833, threadDepth: 14, endCondition: 3 });
  });

  it('maps wizard plane positions to world coordinates for an X-axis hole', () => {
    const def = baseDef();
    def.axis = 0;
    def.kind = 'manual';
    def.params = { kind: 'manual', data: { points: [{ x: 24, y: 12 }] } };
    const [placement] = holeArrayToFeaturePlacements(def);
    expect(placement?.params).toMatchObject({ axis: 0, posX: 0, posY: 24, posZ: 12 });
  });
});
