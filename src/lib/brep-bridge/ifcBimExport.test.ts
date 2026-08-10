import { describe, expect, it } from 'vitest';
import { BIM_REGISTRY_SCHEMA, type BimInformationInstance, type BimInformationRegistry } from '@/lib/bim/informationRegistry';
import { verifyIfcDeepSemanticRoundtrip } from '@/lib/bim/ifcDeepSemanticRoundtrip';
import { validateIfcRegistryBinding } from '@/lib/bim/ifcRegistryBinding';
import { pseudoGuid, selfCheckIfc, writeIfcText } from './ifcExport';
import type { PolyMesh } from './satExport';

const box: PolyMesh = {
  verts: [[0, 0, 0], [20, 0, 0], [20, 30, 0], [0, 30, 0], [0, 0, 40], [20, 0, 40], [20, 30, 40], [0, 30, 40]],
  faces: [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]],
};
const registry: BimInformationRegistry = {
  schema: BIM_REGISTRY_SCHEMA, registryId: 'site-registry', version: '2025.12',
  sourceReferences: [{ id: 'source', path: 'source.xlsx', revision: '2025.12', access: 'read_only' }],
  units: [{ code: 'none', symbol: '-', dimension: 'none' }, { code: 'm', symbol: 'm', dimension: 'length' }],
  classifications: [{ scheme: 'WBS', code: 'A1', name: 'Earthwork', level: 5, sourceRef: 'source' }],
  properties: [
    { pset: 'Pset_Element', key: 'Status', name: 'Status', type: 'string', unit: 'none', requiredAt: ['design'], sourceRef: 'source' },
    { pset: 'Pset_Element', key: 'Length', name: 'Length', type: 'number', unit: 'm', requiredAt: ['design'], sourceRef: 'source' },
  ],
  bepRequirements: [{ key: 'qualityPlan', type: 'object', requiredAt: ['design'], sourceRef: 'source' }],
};
const instance: BimInformationInstance = {
  registryId: 'site-registry', registryVersion: '2025.12', stage: 'design', classifications: [{ scheme: 'WBS', code: 'A1' }],
  properties: [
    { pset: 'Pset_Element', key: 'Status', value: 'Approved', unit: 'none', source: 'user', sourceRef: 'approval:1' },
    { pset: 'Pset_Element', key: 'Length', value: 5, unit: 'm', source: 'derived', sourceRef: 'dimension:1' },
  ],
  bep: { qualityPlan: { reviewer: 'team-a' } },
};

describe('IFC BIM export', () => {
  it('exports exact mesh plus registry identity, provenance, Pset values, WBS, quantity and CRS as IFC4', () => {
    const result = writeIfcText(box, {
      name: 'bim-box',
      bim: {
        instance,
        quantities: [{ setName: 'BaseQuantities', name: 'NetVolume', type: 'volume', value: 0.000024, unit: 'm3' }],
        projectedCrs: { name: 'EPSG:5186', eastings: 200000, northings: 450000, orthogonalHeight: 0, xAxisAbscissa: 1, xAxisOrdinate: 0, scale: 1 },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toContain("FILE_SCHEMA(('IFC4'))");
    expect(selfCheckIfc(result.text).ok).toBe(true);
    expect(verifyIfcDeepSemanticRoundtrip(result.text, result.text)).toMatchObject({ passed: true, errors: [] });
    const proxyGuid = pseudoGuid('nexyfab-w5h:bim-box:proxy');
    expect(validateIfcRegistryBinding(registry, instance, result.text, proxyGuid)).toMatchObject({ passed: true, issues: [] });
  });

  it('refuses an unmapped custom unit instead of silently dropping it', () => {
    const candidate = structuredClone(instance);
    candidate.properties[1]!.unit = 'source_custom';
    const result = writeIfcText(box, {
      bim: { instance: candidate, quantities: [], projectedCrs: { name: 'EPSG:5186', eastings: 0, northings: 0, orthogonalHeight: 0, xAxisAbscissa: 1, xAxisOrdinate: 0, scale: 1 } },
    });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error).toContain('unsupported unit');
  });
});
