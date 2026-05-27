import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerAdapter,
  findAdapterForExtension,
  listAdapters,
  clearAdapters,
  registerLicensedStubs,
  convertImportToMm,
  rollingHash,
  detectChange,
  FeatureIdMap,
  refreshImport,
  type ImportAdapter,
  type NeutralImport,
  type LinkedFileRef,
} from './multiCadImport';

const stubAdapter: ImportAdapter = {
  format: 'step',
  extensions: ['.step', '.stp'],
  sourceUnits: 'mm',
  requiresLicense: false,
  vendor: 'OpenCASCADE',
  parse: async () => ({
    format: 'step',
    sourceFileName: 'test.step',
    sourceFileSizeBytes: 1024,
    sourceHash: 'abc',
    units: 'mm',
    bodies: [],
    assemblies: [],
    metadata: {},
    warnings: [],
  }),
};

beforeEach(() => clearAdapters());

describe('adapter registry', () => {
  it('register + find by extension', () => {
    registerAdapter(stubAdapter);
    const a = findAdapterForExtension('part.step');
    expect(a?.format).toBe('step');
  });

  it('case-insensitive extension match', () => {
    registerAdapter(stubAdapter);
    expect(findAdapterForExtension('PART.STP')).toBeDefined();
  });

  it('returns null for unknown extension', () => {
    registerAdapter(stubAdapter);
    expect(findAdapterForExtension('part.foo')).toBeNull();
  });

  it('listAdapters returns registered set', () => {
    registerAdapter(stubAdapter);
    expect(listAdapters()).toHaveLength(1);
  });
});

describe('registerLicensedStubs', () => {
  it('registers ≥ 8 licensed stub adapters', () => {
    registerLicensedStubs();
    expect(listAdapters().length).toBeGreaterThanOrEqual(8);
  });

  it('CATPart adapter throws on parse (license required)', async () => {
    registerLicensedStubs();
    const a = findAdapterForExtension('part.CATPart')!;
    await expect(a.parse(new ArrayBuffer(0), 'part.CATPart')).rejects.toThrow(/licensed/i);
  });

  it('every licensed stub is marked requiresLicense = true', () => {
    registerLicensedStubs();
    for (const a of listAdapters()) {
      expect(a.requiresLicense).toBe(true);
    }
  });
});

describe('convertImportToMm', () => {
  function makeImport(units: 'mm' | 'cm' | 'in'): NeutralImport {
    return {
      format: 'step',
      sourceFileName: 'x.step',
      sourceFileSizeBytes: 0,
      sourceHash: '',
      units,
      bodies: [{ id: 'b1', name: '', positions: [10, 20, 30], indices: [] }],
      assemblies: [],
      metadata: {},
      warnings: [],
    };
  }

  it('mm input → no-op', () => {
    const imp = makeImport('mm');
    expect(convertImportToMm(imp).bodies[0]!.positions).toEqual([10, 20, 30]);
  });

  it('cm input → scaled by 10', () => {
    const imp = makeImport('cm');
    const r = convertImportToMm(imp);
    expect(r.bodies[0]!.positions).toEqual([100, 200, 300]);
    expect(r.units).toBe('mm');
  });

  it('inch input → scaled by 25.4', () => {
    const imp = makeImport('in');
    const r = convertImportToMm(imp);
    expect(r.bodies[0]!.positions[0]).toBeCloseTo(254, 4);
  });
});

describe('rollingHash', () => {
  it('same buffer → same hash', () => {
    const buf = new TextEncoder().encode('hello').buffer;
    expect(rollingHash(buf)).toBe(rollingHash(buf));
  });

  it('different content → different hash', () => {
    const a = new TextEncoder().encode('hello').buffer;
    const b = new TextEncoder().encode('world').buffer;
    expect(rollingHash(a)).not.toBe(rollingHash(b));
  });
});

describe('detectChange', () => {
  const ref: LinkedFileRef = {
    sourcePath: 'x.step', format: 'step',
    lastSeenHash: rollingHash(new TextEncoder().encode('hello').buffer),
    lastSeenSizeBytes: 5, lastImportedAt: '2026-01-01',
  };

  it('unchanged when same content', () => {
    const buf = new TextEncoder().encode('hello').buffer;
    expect(detectChange(ref, buf).changed).toBe(false);
  });

  it('size-differs flagged', () => {
    const buf = new TextEncoder().encode('hellooo').buffer;
    const r = detectChange(ref, buf);
    expect(r.changed).toBe(true);
    expect(r.reason).toBe('size-differs');
  });

  it('content-differs flagged for same-size mutation', () => {
    const buf = new TextEncoder().encode('world').buffer;
    const r = detectChange(ref, buf);
    expect(r.changed).toBe(true);
    expect(r.reason).toBe('content-differs');
  });
});

describe('FeatureIdMap', () => {
  it('bidirectional lookup', () => {
    const m = new FeatureIdMap();
    m.set('internal-1', 'source-A');
    expect(m.getSource('internal-1')).toBe('source-A');
    expect(m.getInternal('source-A')).toBe('internal-1');
  });

  it('built from import', () => {
    const imp: NeutralImport = {
      format: 'step', sourceFileName: '', sourceFileSizeBytes: 0, sourceHash: '',
      units: 'mm',
      bodies: [
        { id: 'b1', name: '', positions: [], indices: [], sourceFeatureId: 'CATFEAT-A' },
        { id: 'b2', name: '', positions: [], indices: [], sourceFeatureId: 'CATFEAT-B' },
      ],
      assemblies: [], metadata: {}, warnings: [],
    };
    const m = FeatureIdMap.fromImport(imp);
    expect(m.size()).toBe(2);
    expect(m.getInternal('CATFEAT-A')).toBe('b1');
  });
});

describe('refreshImport', () => {
  function makeImp(featureIds: string[]): NeutralImport {
    return {
      format: 'step', sourceFileName: '', sourceFileSizeBytes: 0, sourceHash: '',
      units: 'mm',
      bodies: featureIds.map((id, i) => ({
        id: `b${i}`, name: '', positions: [], indices: [], sourceFeatureId: id,
      })),
      assemblies: [], metadata: {}, warnings: [],
    };
  }

  it('reports matched / added / removed', () => {
    const previous = makeImp(['A', 'B', 'C']);
    const fresh = makeImp(['B', 'C', 'D']);
    const r = refreshImport(previous, fresh);
    expect(r.matched).toBe(2);
    expect(r.added).toEqual(['D']);
    expect(r.removed).toEqual(['A']);
  });

  it('all matched when files identical', () => {
    const previous = makeImp(['A', 'B']);
    const fresh = makeImp(['A', 'B']);
    const r = refreshImport(previous, fresh);
    expect(r.matched).toBe(2);
    expect(r.added).toHaveLength(0);
    expect(r.removed).toHaveLength(0);
  });
});
