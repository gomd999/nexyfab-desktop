import { describe, it, expect } from 'vitest';
import {
  validateParameters,
  createInstance,
  migrateInstance,
  serializeAsset,
  deserializeAsset,
  AssetLibrary,
  type AssetDefinition,
} from './houdiniStyleAsset';

const sampleAsset: AssetDefinition = {
  id: 'test.bolt',
  name: 'Test Bolt',
  version: '1.0.0',
  parameters: [
    { id: 'diameter', label: 'Diameter', kind: 'number', defaultValue: 5, validation: { min: 1, max: 50 } },
    { id: 'length', label: 'Length', kind: 'integer', defaultValue: 20 },
    { id: 'material', label: 'Material', kind: 'enum', defaultValue: 'steel', validation: { enumValues: ['steel', 'titanium'] } },
    { id: 'serrated', label: 'Serrated', kind: 'boolean', defaultValue: false },
  ],
  groups: [{ id: 'main', label: 'Main' }],
  inputs: [],
  outputs: [{ id: 'body', label: 'Bolt body', kind: 'body' }],
  recipe: { tag: 'bolt-recipe-v1' },
};

describe('createInstance', () => {
  it('populates defaults', () => {
    const inst = createInstance(sampleAsset);
    expect(inst.parameters.diameter).toBe(5);
    expect(inst.parameters.material).toBe('steel');
  });

  it('overrides honored', () => {
    const inst = createInstance(sampleAsset, { diameter: 8 });
    expect(inst.parameters.diameter).toBe(8);
  });

  it('points to source asset id + version', () => {
    const inst = createInstance(sampleAsset);
    expect(inst.assetId).toBe('test.bolt');
    expect(inst.assetVersion).toBe('1.0.0');
  });
});

describe('validateParameters', () => {
  it('valid defaults → 0 errors', () => {
    const inst = createInstance(sampleAsset);
    expect(validateParameters(sampleAsset, inst).filter(i => i.severity === 'error')).toHaveLength(0);
  });

  it('out-of-range value flagged', () => {
    const inst = createInstance(sampleAsset, { diameter: 100 });
    const issues = validateParameters(sampleAsset, inst);
    expect(issues.some(i => i.paramId === 'diameter')).toBe(true);
  });

  it('non-integer in integer field flagged', () => {
    const inst = createInstance(sampleAsset, { length: 3.14 });
    const issues = validateParameters(sampleAsset, inst);
    expect(issues.some(i => i.paramId === 'length' && i.message.includes('integer'))).toBe(true);
  });

  it('bad enum value flagged', () => {
    const inst = createInstance(sampleAsset, { material: 'wood' });
    const issues = validateParameters(sampleAsset, inst);
    expect(issues.some(i => i.paramId === 'material')).toBe(true);
  });

  it('unknown parameter warns', () => {
    const inst = createInstance(sampleAsset, { unknown: 1 });
    const issues = validateParameters(sampleAsset, inst);
    expect(issues.some(i => i.paramId === 'unknown')).toBe(true);
  });

  it('wrong type for vec3', () => {
    const asset = { ...sampleAsset, parameters: [{ id: 'pos', label: 'Pos', kind: 'vec3' as const, defaultValue: [0, 0, 0] as [number, number, number] }] };
    const inst = createInstance(asset, { pos: 'not-a-vec' });
    expect(validateParameters(asset, inst).some(i => i.severity === 'error')).toBe(true);
  });
});

describe('migrateInstance', () => {
  it('adds new parameter with default', () => {
    const old = createInstance(sampleAsset);
    const newAsset = {
      ...sampleAsset,
      version: '2.0.0',
      parameters: [
        ...sampleAsset.parameters,
        { id: 'finish', label: 'Finish', kind: 'enum' as const, defaultValue: 'matte' },
      ],
    };
    const r = migrateInstance(old, newAsset);
    expect(r.instance.parameters.finish).toBe('matte');
    expect(r.notes.some(n => n.includes('finish'))).toBe(true);
  });

  it('drops removed parameter', () => {
    const old = createInstance(sampleAsset);
    const newAsset = {
      ...sampleAsset,
      version: '2.0.0',
      parameters: sampleAsset.parameters.filter(p => p.id !== 'serrated'),
    };
    const r = migrateInstance(old, newAsset);
    expect('serrated' in r.instance.parameters).toBe(false);
    expect(r.notes.some(n => n.includes('serrated'))).toBe(true);
  });

  it('updates version', () => {
    const old = createInstance(sampleAsset);
    const newAsset = { ...sampleAsset, version: '2.0.0' };
    expect(migrateInstance(old, newAsset).instance.assetVersion).toBe('2.0.0');
  });
});

describe('serialize / deserialize', () => {
  it('round-trips', () => {
    const json = serializeAsset(sampleAsset);
    const r = deserializeAsset(json);
    expect(r.id).toBe(sampleAsset.id);
    expect(r.parameters).toHaveLength(sampleAsset.parameters.length);
  });
});

describe('AssetLibrary', () => {
  it('register + get', () => {
    const lib = new AssetLibrary();
    lib.register(sampleAsset);
    expect(lib.get('test.bolt', '1.0.0')).not.toBeNull();
  });

  it('latest returns highest semver', () => {
    const lib = new AssetLibrary();
    lib.register({ ...sampleAsset, version: '1.0.0' });
    lib.register({ ...sampleAsset, version: '2.3.0' });
    lib.register({ ...sampleAsset, version: '2.1.0' });
    expect(lib.latest('test.bolt')?.version).toBe('2.3.0');
  });

  it('list returns all registered', () => {
    const lib = new AssetLibrary();
    lib.register({ ...sampleAsset, version: '1.0.0' });
    lib.register({ ...sampleAsset, version: '1.1.0' });
    expect(lib.list()).toHaveLength(2);
  });

  it('get returns null for unknown', () => {
    const lib = new AssetLibrary();
    expect(lib.get('nope', '1.0.0')).toBeNull();
  });
});
