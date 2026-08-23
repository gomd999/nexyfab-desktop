import { describe, expect, it } from 'vitest';
import { validateTree } from '@/lib/cad/featureTree';
import { featureTreeToOcctPlan } from '@/lib/occt/featurePlan';
import type { PlacedPart } from './PartPlacementPanel';
import {
  createDefaultAssemblyPartTree,
  provisionPlacedPartFeatureTree,
} from './placedPartFeatureTreeProvisioning';

function part(shapeId: string, params: Record<string, number>): PlacedPart {
  return {
    id: `part-${shapeId}`,
    name: shapeId,
    shapeId,
    params,
    qty: 1,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
  };
}

describe('placed-part FeatureTree provisioning', () => {
  it('creates a centered, editable default box for a manually added part', () => {
    const tree = createDefaultAssemblyPartTree('part-1', 30);
    expect(() => validateTree(tree)).not.toThrow();
    expect(tree.nodes[0]?.payload).toMatchObject({
      kind: 'extrude',
      depth: 30,
      profileOffsetZ: -15,
    });
  });

  it.each([
    ['box', { width: 80, height: 25, depth: 12 }],
    ['cylinder', { diameter: 40, height: 60, innerDiameter: 12 }],
    ['disk', { diameter: 70, thickness: 6, innerDia: 10 }],
    ['cone', { bottomDiameter: 50, topDiameter: 20, height: 45 }],
    ['pipe', { outerDiameter: 50, innerDiameter: 42, length: 100 }],
    ['washer', { innerDia: 10, outerDia: 25, thickness: 2 }],
    ['lBracket', { width: 80, height: 60, thickness: 8, depth: 30 }],
    ['wedge', { width: 50, height: 35, depth: 20 }],
  ])('losslessly provisions the supported %s primitive', (shapeId, params) => {
    const provision = provisionPlacedPartFeatureTree(part(shapeId, params));
    expect(provision.status).toBe('exact');
    if (provision.status !== 'exact') return;
    expect(provision.tree.nodes.length).toBeGreaterThan(0);
    expect(() => validateTree(provision.tree)).not.toThrow();
  });

  it('provisions the displayed involute gear profile and through bore without an envelope', () => {
    const provision = provisionPlacedPartFeatureTree(part('gear', {
      teeth: 24,
      module: 2,
      width: 15,
      boreDiameter: 10,
      pressureAngle: 20,
    }));
    expect(provision.status).toBe('exact');
    if (provision.status !== 'exact') return;
    expect(() => validateTree(provision.tree)).not.toThrow();
    expect(provision.tree.nodes).toHaveLength(2);
    expect(provision.tree.nodes[0]?.payload).toMatchObject({ kind: 'extrude', depth: 15, profileOffsetZ: -7.5 });
    expect(provision.tree.nodes[1]).toMatchObject({
      dependencies: ['part-gear:gear-profile'],
      payload: { kind: 'hole', diameter: 10, terminationMode: 'through' },
    });
    const occtPlan = featureTreeToOcctPlan(provision.tree);
    expect(occtPlan.unsupported).toEqual([]);
    expect(occtPlan.commands.map((command) => command.op)).toEqual(['extrude', 'hole']);
    expect(occtPlan.finalResultId).toBe('part-gear:shaft-bore');
  });
});
