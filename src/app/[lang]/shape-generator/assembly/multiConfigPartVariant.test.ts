import { describe, it, expect } from 'vitest';
import {
  resolveConfig,
  diffConfigs,
  validateModel,
  summarize,
  type PartModel,
  type Configuration,
} from './multiConfigPartVariant';

function baseModel(): PartModel {
  return {
    features: [
      { id: 'f1', suppressed: false },
      { id: 'f2', suppressed: false },
      { id: 'f3', suppressed: false },
    ],
    parameters: new Map([['size', 100], ['holeDia', 6]]),
    configurations: [
      {
        name: 'lightened',
        parent: '',
        featureOverrides: new Map([['f3', { id: 'f3', suppressed: true }]]),
        parameterOverrides: new Map(),
        metadata: {},
      },
      {
        name: 'service',
        parent: '',
        featureOverrides: new Map(),
        parameterOverrides: new Map([['holeDia', 8]]),
        metadata: {},
      },
    ],
  };
}

describe('resolveConfig', () => {
  it('unknown name → master copy', () => {
    const r = resolveConfig(baseModel(), 'nonexistent');
    expect(r.features).toHaveLength(3);
  });

  it('lightened suppresses f3', () => {
    const r = resolveConfig(baseModel(), 'lightened');
    const f3 = r.features.find(f => f.id === 'f3')!;
    expect(f3.suppressed).toBe(true);
  });

  it('service overrides holeDia', () => {
    const r = resolveConfig(baseModel(), 'service');
    expect(r.parameters.get('holeDia')).toBe(8);
  });

  it('inheritance walks parent chain', () => {
    const model = baseModel();
    const child: Configuration = {
      name: 'lightened-service',
      parent: 'lightened',
      featureOverrides: new Map(),
      parameterOverrides: new Map([['size', 200]]),
      metadata: {},
    };
    model.configurations.push(child);
    const r = resolveConfig(model, 'lightened-service');
    expect(r.parameters.get('size')).toBe(200);
    expect(r.features.find(f => f.id === 'f3')!.suppressed).toBe(true);
  });
});

describe('diffConfigs', () => {
  it('suppression diff captured', () => {
    const diff = diffConfigs(baseModel(), 'lightened', 'service');
    expect(diff.suppressedInA).toContain('f3');
  });

  it('parameter diff captured', () => {
    const diff = diffConfigs(baseModel(), 'lightened', 'service');
    expect(diff.paramDeltas.some(d => d.name === 'holeDia')).toBe(true);
  });

  it('same config → empty diff', () => {
    const diff = diffConfigs(baseModel(), 'lightened', 'lightened');
    expect(diff.suppressedInA).toEqual([]);
    expect(diff.suppressedInB).toEqual([]);
    expect(diff.paramDeltas).toEqual([]);
  });
});

describe('validateModel', () => {
  it('clean model → no issues', () => {
    expect(validateModel(baseModel())).toEqual([]);
  });

  it('unknown feature override → error', () => {
    const model = baseModel();
    model.configurations[0]!.featureOverrides.set('fX', { id: 'fX', suppressed: true });
    const issues = validateModel(model);
    expect(issues.some(i => i.message.includes('fX'))).toBe(true);
  });

  it('unknown parameter → error', () => {
    const model = baseModel();
    model.configurations[0]!.parameterOverrides.set('unknown', 5);
    expect(validateModel(model).some(i => i.message.includes('unknown'))).toBe(true);
  });

  it('missing parent → error', () => {
    const model = baseModel();
    model.configurations.push({
      name: 'orphan', parent: 'ghost',
      featureOverrides: new Map(), parameterOverrides: new Map(), metadata: {},
    });
    expect(validateModel(model).some(i => i.message.includes('ghost'))).toBe(true);
  });

  it('parent cycle → error', () => {
    const model = baseModel();
    model.configurations[0]!.parent = 'service';
    model.configurations[1]!.parent = 'lightened';
    const issues = validateModel(model);
    expect(issues.some(i => i.message.includes('cycle'))).toBe(true);
  });
});

describe('summarize', () => {
  it('reports counts', () => {
    const s = summarize(baseModel());
    expect(s.featureCount).toBe(3);
    expect(s.parameterCount).toBe(2);
    expect(s.configurationCount).toBe(2);
  });
});
