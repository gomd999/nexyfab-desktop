import { describe, it, expect } from 'vitest';
import {
  MacroRecorder,
  serializeMacroToScript,
  normalizeMacro,
  predictReplayFeatures,
  type Macro,
} from './macroRecorder';

describe('MacroRecorder', () => {
  it('does nothing when not recording', () => {
    const r = new MacroRecorder();
    r.record({ kind: 'addFeature', featureType: 'fillet', params: { radius: 3 } });
    expect(r.snapshot()).toHaveLength(0);
  });

  it('records when started', () => {
    const r = new MacroRecorder();
    r.start();
    r.record({ kind: 'addFeature', featureType: 'fillet', params: { radius: 3 } });
    expect(r.snapshot()).toHaveLength(1);
  });

  it('stops recording on stop()', () => {
    const r = new MacroRecorder();
    r.start();
    r.record({ kind: 'addFeature', featureType: 'fillet', params: { radius: 3 } });
    r.stop();
    r.record({ kind: 'addFeature', featureType: 'chamfer', params: { distance: 2 } });
    expect(r.snapshot()).toHaveLength(1);
  });

  it('reset() clears all state', () => {
    const r = new MacroRecorder();
    r.start();
    r.record({ kind: 'addFeature', featureType: 'fillet', params: {} });
    r.reset();
    expect(r.isRecording()).toBe(false);
    expect(r.snapshot()).toHaveLength(0);
  });

  it('attaches timestamp t to each step', () => {
    const r = new MacroRecorder();
    r.start();
    r.record({ kind: 'addFeature', featureType: 'fillet', params: {} });
    const steps = r.snapshot();
    expect(steps[0]).toHaveProperty('t');
  });
});

describe('serializeMacroToScript', () => {
  const macro: Macro = {
    id: 'm1',
    name: 'Test macro',
    createdAt: Date.now(),
    steps: [
      { kind: 'clearAll', t: 0 },
      { kind: 'addFeature', featureType: 'fillet', params: { radius: 3 }, t: 100 },
      { kind: 'addFeature', featureType: 'chamfer', params: { distance: 2 }, t: 200 },
    ],
  };

  it('emits nf.* API calls', () => {
    const src = serializeMacroToScript(macro);
    expect(src).toContain('nf.clearAll()');
    expect(src).toContain('nf.addFeature("fillet"');
    expect(src).toContain('nf.addFeature("chamfer"');
  });

  it('includes header comments by default', () => {
    const src = serializeMacroToScript(macro);
    expect(src).toMatch(/\/\/ Macro: Test macro/);
  });

  it('omits comments when disabled', () => {
    const src = serializeMacroToScript(macro, { withComments: false });
    expect(src).not.toMatch(/\/\/ Macro:/);
  });

  it('escapes feature ids correctly', () => {
    const m: Macro = {
      ...macro,
      steps: [{ kind: 'removeFeature', featureId: 'f_42', t: 0 }],
    };
    const src = serializeMacroToScript(m);
    expect(src).toContain('"f_42"');
  });
});

describe('normalizeMacro', () => {
  it('strips timestamps', () => {
    const steps = [
      { kind: 'clearAll' as const, t: 0 },
      { kind: 'addFeature' as const, featureType: 'fillet' as const, params: { radius: 3 }, t: 100 },
    ];
    const norm = normalizeMacro(steps);
    expect(norm[0]).not.toHaveProperty('t');
  });
});

describe('predictReplayFeatures', () => {
  it('produces empty list for clear-only macro', () => {
    const m: Macro = {
      id: 'm', name: 'x', createdAt: 0,
      steps: [{ kind: 'clearAll', t: 0 }],
    };
    expect(predictReplayFeatures(m)).toEqual([]);
  });

  it('counts addFeature steps', () => {
    const m: Macro = {
      id: 'm', name: 'x', createdAt: 0,
      steps: [
        { kind: 'addFeature', featureType: 'fillet', params: { radius: 3 }, t: 0 },
        { kind: 'addFeature', featureType: 'chamfer', params: { distance: 2 }, t: 100 },
      ],
    };
    expect(predictReplayFeatures(m)).toHaveLength(2);
  });

  it('respects clearAll + add', () => {
    const m: Macro = {
      id: 'm', name: 'x', createdAt: 0,
      steps: [
        { kind: 'addFeature', featureType: 'fillet', params: {}, t: 0 },
        { kind: 'clearAll', t: 100 },
        { kind: 'addFeature', featureType: 'chamfer', params: {}, t: 200 },
      ],
    };
    expect(predictReplayFeatures(m)).toHaveLength(1);
  });
});
