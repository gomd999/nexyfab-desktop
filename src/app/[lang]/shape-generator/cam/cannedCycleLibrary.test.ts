import { describe, it, expect } from 'vitest';
import {
  CYCLE_LIBRARY,
  lookupCycle,
  validateBlock,
  emitGcode,
  estimateCycleTimeSec,
  summarize,
  type CycleBlock,
} from './cannedCycleLibrary';

const drill: CycleBlock = {
  code: 'G81',
  positions: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
  parameters: { z: -10, r: 2, f: 100 },
};

const peck: CycleBlock = {
  code: 'G83',
  positions: [{ x: 0, y: 0 }],
  parameters: { z: -30, r: 2, f: 100, q: 5 },
};

const spot: CycleBlock = {
  code: 'G82',
  positions: [{ x: 0, y: 0 }],
  parameters: { z: -3, r: 2, f: 200, p: 500 },
};

describe('CYCLE_LIBRARY', () => {
  it('contains G81 and G83', () => {
    expect(CYCLE_LIBRARY.G81).toBeDefined();
    expect(CYCLE_LIBRARY.G83).toBeDefined();
  });

  it('G83 requires Q', () => {
    expect(CYCLE_LIBRARY.G83.required).toContain('q');
  });

  it('G82 requires P (dwell)', () => {
    expect(CYCLE_LIBRARY.G82.required).toContain('p');
  });
});

describe('lookupCycle', () => {
  it('finds by code', () => {
    expect(lookupCycle('G83')?.operation).toBe('peck-drill');
  });

  it('finds by operation name', () => {
    expect(lookupCycle('peck-drill')?.code).toBe('G83');
  });

  it('case insensitive', () => {
    expect(lookupCycle('g81')?.operation).toBe('drill');
  });

  it('returns undefined on unknown', () => {
    expect(lookupCycle('G999')).toBeUndefined();
  });
});

describe('validateBlock', () => {
  it('valid G81 block → ok', () => {
    expect(validateBlock(drill).ok).toBe(true);
  });

  it('missing F → not ok', () => {
    const bad: CycleBlock = { ...drill, parameters: { z: -10, r: 2 } };
    const v = validateBlock(bad);
    expect(v.ok).toBe(false);
    expect(v.missingParameters).toContain('F');
  });

  it('G83 missing Q → not ok', () => {
    const bad: CycleBlock = { ...peck, parameters: { z: -30, r: 2, f: 100 } };
    expect(validateBlock(bad).ok).toBe(false);
  });

  it('warns when R-plane below Z', () => {
    const wrong: CycleBlock = { ...drill, parameters: { z: 10, r: 2, f: 100 } };
    const v = validateBlock(wrong);
    expect(v.warnings.some(w => w.includes('R-plane'))).toBe(true);
  });

  it('warns when no positions', () => {
    const empty: CycleBlock = { ...drill, positions: [] };
    const v = validateBlock(empty);
    expect(v.warnings.some(w => w.includes('no positions'))).toBe(true);
  });

  it('warns on negative Q', () => {
    const bad: CycleBlock = { ...peck, parameters: { z: -30, r: 2, f: 100, q: -5 } };
    expect(validateBlock(bad).warnings.length).toBeGreaterThan(0);
  });
});

describe('emitGcode (fanuc)', () => {
  it('produces a G98 + G81 header', () => {
    const lines = emitGcode(drill, { dialect: 'fanuc', modal: true, retract: 'g98' });
    expect(lines[0]).toContain('G98');
    expect(lines[0]).toContain('G81');
  });

  it('modal mode emits XY only after first', () => {
    const lines = emitGcode(drill, { dialect: 'fanuc', modal: true, retract: 'g98' });
    expect(lines[1]).toMatch(/^X\d/);
  });

  it('non-modal emits G81 each line', () => {
    const lines = emitGcode(drill, { dialect: 'fanuc', modal: false, retract: 'g98' });
    expect(lines[1]).toContain('G81');
  });

  it('terminates with G80', () => {
    const lines = emitGcode(drill);
    expect(lines[lines.length - 1]).toBe('G80');
  });

  it('G83 includes Q parameter', () => {
    const lines = emitGcode(peck);
    expect(lines[0]).toContain('Q5');
  });

  it('G82 includes P parameter as integer', () => {
    const lines = emitGcode(spot);
    expect(lines[0]).toContain('P500');
  });
});

describe('emitGcode (siemens)', () => {
  it('uses CYCLE prefix', () => {
    const lines = emitGcode(drill, { dialect: 'siemens', modal: true, retract: 'g98' });
    expect(lines.join('\n')).toContain('CYCLE81');
  });
});

describe('emitGcode (heidenhain)', () => {
  it('uses CYCL DEF', () => {
    const lines = emitGcode(drill, { dialect: 'heidenhain', modal: true, retract: 'g98' });
    expect(lines[0]).toContain('CYCL DEF');
  });
});

describe('estimateCycleTimeSec', () => {
  it('zero feed → zero time', () => {
    const bad: CycleBlock = { ...drill, parameters: { z: -10, r: 2, f: 0 } };
    expect(estimateCycleTimeSec(bad)).toBe(0);
  });

  it('positive for valid drill', () => {
    expect(estimateCycleTimeSec(drill)).toBeGreaterThan(0);
  });

  it('peck takes longer than drill (overhead)', () => {
    const sameDepthDrill: CycleBlock = { ...drill, positions: [{ x: 0, y: 0 }], parameters: { z: -30, r: 2, f: 100 } };
    expect(estimateCycleTimeSec(peck)).toBeGreaterThan(estimateCycleTimeSec(sameDepthDrill));
  });

  it('scales with hole count', () => {
    const one: CycleBlock = { ...drill, positions: [{ x: 0, y: 0 }] };
    const ten: CycleBlock = { ...drill, positions: Array.from({ length: 10 }, (_, i) => ({ x: i, y: 0 })) };
    expect(estimateCycleTimeSec(ten)).toBeGreaterThan(estimateCycleTimeSec(one) * 5);
  });
});

describe('summarize', () => {
  it('reports operation + count + time', () => {
    const s = summarize(drill);
    expect(s.code).toBe('G81');
    expect(s.holeCount).toBe(2);
    expect(s.validationOk).toBe(true);
  });

  it('validationOk false on bad block', () => {
    const bad: CycleBlock = { ...drill, parameters: { z: -10, r: 2 } };
    expect(summarize(bad).validationOk).toBe(false);
  });
});
