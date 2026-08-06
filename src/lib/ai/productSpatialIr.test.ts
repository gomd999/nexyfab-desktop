import { describe, expect, it } from 'vitest';
import { productSpatialReleaseReady, validateProductSpatialIr, type ProductSpatialIr } from './productSpatialIr';

const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as const;
const valid = (): ProductSpatialIr => ({
  schema: 'nexyfab.product-spatial-ir.v1', units: 'mm',
  definitions: [{ id: 'wall-type', name: 'Wall', kind: 'element-type' }],
  nodes: [
    { id: 'project', kind: 'project', name: 'Project', localToParent: I, worldTransform: I },
    { id: 'storey', kind: 'storey', name: 'L1', parentId: 'project', localToParent: I, worldTransform: I },
    { id: 'wall-1', kind: 'element', name: 'Wall 1', parentId: 'storey', definitionId: 'wall-type', localToParent: I, worldTransform: I },
  ],
});

describe('Product/Spatial IR', () => {
  it('keeps spatial containers separate from physical definitions', () => {
    expect(validateProductSpatialIr(valid())).toEqual([]);
    expect(productSpatialReleaseReady(valid())).toBe(true);
  });

  it('fails closed for missing placement evidence', () => {
    const ir = valid(); delete ir.nodes[2]!.worldTransform;
    expect(validateProductSpatialIr(ir)).toEqual([]);
    expect(productSpatialReleaseReady(ir)).toBe(false);
  });

  it('rejects cycles and assigning product definitions to spaces', () => {
    const ir = valid(); ir.nodes[0]!.parentId = 'storey'; ir.nodes[1]!.definitionId = 'wall-type';
    const codes = validateProductSpatialIr(ir).map(issue => issue.code);
    expect(codes).toContain('CYCLIC_HIERARCHY');
    expect(codes).toContain('SPATIAL_AS_PRODUCT');
  });
});
