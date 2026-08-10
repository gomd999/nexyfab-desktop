import { describe, expect, it } from 'vitest';
import {
  BIM_REGISTRY_SCHEMA,
  validateBimInformationInstance,
  validateBimInformationRegistry,
  type BimInformationInstance,
  type BimInformationRegistry,
} from './informationRegistry';

function registry(): BimInformationRegistry {
  return {
    schema: BIM_REGISTRY_SCHEMA,
    registryId: 'lh-site-guideline',
    version: '2025.12+nexyfab.1',
    sourceReferences: [
      { id: 'wbs', path: 'appendix-01.xlsx', sheet: 'dictionary', revision: '2025.12', access: 'read_only' },
      { id: 'pset', path: 'appendix-02.xlsx', sheet: 'object-example', revision: '2025.12', access: 'read_only' },
      { id: 'bep', path: 'nexyfab-bep-minimum', revision: '1', access: 'read_only' },
    ],
    units: [
      { code: 'none', symbol: '-', dimension: 'none' },
      { code: 'mm', symbol: 'mm', dimension: 'length' },
      { code: 'mm2', symbol: 'mm2', dimension: 'area' },
    ],
    classifications: [
      { scheme: 'OBS', code: 'C', name: 'site', level: 1, sourceRef: 'wbs' },
      { scheme: 'OBS', code: '01', name: 'common facility', level: 2, parentCode: 'C', sourceRef: 'wbs' },
      { scheme: 'WBS', code: 'A1', name: 'earthwork', level: 5, sourceRef: 'wbs' },
    ],
    properties: [
      { pset: 'Pset_Wall', key: 'length', name: 'Length', type: 'number', unit: 'mm', requiredAt: ['design'], sourceRef: 'pset' },
      { pset: 'Pset_Wall', key: 'height', name: 'Height', type: 'number', unit: 'mm', requiredAt: ['design'], sourceRef: 'pset' },
      { pset: 'Pset_Wall', key: 'area', name: 'Area', type: 'number', unit: 'mm2', requiredAt: ['design'], formula: { expression: 'length * height', variables: ['length', 'height'], tolerance: 0.01 }, sourceRef: 'pset' },
      { pset: 'Pset_Wall', key: 'objectName', name: 'Object name', type: 'string', unit: 'none', requiredAt: ['design'], sourceRef: 'pset' },
    ],
    bepRequirements: [
      { key: 'coordinateSystem', type: 'string', requiredAt: ['design'], sourceRef: 'bep' },
      { key: 'responsibilityMatrix', type: 'object', requiredAt: ['design'], sourceRef: 'bep' },
    ],
  };
}

function instance(): BimInformationInstance {
  return {
    registryId: 'lh-site-guideline', registryVersion: '2025.12+nexyfab.1', stage: 'design',
    classifications: [{ scheme: 'OBS', code: '01' }, { scheme: 'WBS', code: 'A1' }],
    properties: [
      { pset: 'Pset_Wall', key: 'length', value: 5000, unit: 'mm', source: 'user', sourceRef: 'dimension:d1' },
      { pset: 'Pset_Wall', key: 'height', value: 3000, unit: 'mm', source: 'user', sourceRef: 'level:l1' },
      { pset: 'Pset_Wall', key: 'area', value: 15_000_000, unit: 'mm2', source: 'derived', sourceRef: 'formula:Pset_Wall.area' },
      { pset: 'Pset_Wall', key: 'objectName', value: 'Wall-01', unit: 'none', source: 'ai', sourceRef: 'user-approved:name' },
    ],
    bep: { coordinateSystem: 'EPSG:5186', responsibilityMatrix: { modeler: 'team-a' } },
  };
}

describe('BIM information registry', () => {
  it('accepts a versioned WBS/OBS/Pset/BEP contract and a traceable instance', () => {
    expect(validateBimInformationRegistry(registry())).toEqual({ status: 'valid', issues: [] });
    expect(validateBimInformationInstance(registry(), instance())).toEqual({ status: 'valid', issues: [] });
  });

  it('fails closed on Excel error tokens, unknown dependencies, and formula cycles', () => {
    const candidate = registry();
    candidate.properties[2]!.formula = { expression: '#REF! * height', variables: ['height'] };
    candidate.properties.push({ pset: 'Pset_Wall', key: 'cycleA', name: 'A', type: 'number', unit: 'mm', requiredAt: [], formula: { expression: 'cycleB + 1', variables: ['cycleB'] }, sourceRef: 'pset' });
    candidate.properties.push({ pset: 'Pset_Wall', key: 'cycleB', name: 'B', type: 'number', unit: 'mm', requiredAt: [], formula: { expression: 'cycleA + 1', variables: ['cycleA'] }, sourceRef: 'pset' });
    const report = validateBimInformationRegistry(candidate);
    expect(report.status).toBe('invalid');
    expect(report.issues.map(value => value.code)).toEqual(expect.arrayContaining(['FORMULA_EXCEL_ERROR', 'FORMULA_CYCLE']));
  });

  it('rejects registry drift, unknown codes, wrong units/types, and missing required values', () => {
    const candidate = instance();
    candidate.registryVersion = 'stale';
    candidate.classifications.push({ scheme: 'WBS', code: 'UNKNOWN' });
    candidate.properties = candidate.properties.filter(value => value.key !== 'height');
    candidate.properties.find(value => value.key === 'length')!.unit = 'none';
    candidate.properties.find(value => value.key === 'objectName')!.value = 42;
    delete candidate.bep.coordinateSystem;
    const report = validateBimInformationInstance(registry(), candidate);
    expect(report.status).toBe('invalid');
    expect(report.issues.map(value => value.code)).toEqual(expect.arrayContaining([
      'REGISTRY_VERSION_INVALID', 'CLASSIFICATION_UNKNOWN', 'PROPERTY_REQUIRED',
      'PROPERTY_UNIT_INVALID', 'PROPERTY_TYPE_INVALID', 'BEP_REQUIRED', 'FORMULA_RESULT_INVALID',
    ]));
  });

  it('requires formula outputs to be derived and numerically exact within tolerance', () => {
    const candidate = instance();
    const area = candidate.properties.find(value => value.key === 'area')!;
    area.source = 'ai';
    area.value = 14_000_000;
    const report = validateBimInformationInstance(registry(), candidate);
    expect(report.issues.map(value => value.code)).toEqual(expect.arrayContaining(['PROPERTY_PROVENANCE_INVALID', 'FORMULA_RESULT_MISMATCH']));
  });

  it('rejects unknown BEP keys so schema drift cannot silently enter delivery packages', () => {
    const candidate = instance();
    candidate.bep.unreviewedField = true;
    expect(validateBimInformationInstance(registry(), candidate).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'BEP_REQUIREMENT_UNKNOWN' }),
    ]));
  });
});
