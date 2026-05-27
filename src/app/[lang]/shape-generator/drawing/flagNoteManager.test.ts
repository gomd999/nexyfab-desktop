import { describe, it, expect } from 'vitest';
import {
  createFlagNoteSystem,
  addFlagNote,
  removeFlagNote,
  getFlagNote,
  anchorFlagNote,
  renumberFlags,
  validateFlagSystem,
  whereUsed,
  defaultRenderHint,
  summarize,
} from './flagNoteManager';

describe('createFlagNoteSystem', () => {
  it('starts empty', () => {
    const s = createFlagNoteSystem();
    expect(s.notes).toEqual([]);
    expect(s.nextNumber).toBe(1);
  });
});

describe('addFlagNote', () => {
  it('assigns sequential numbers', () => {
    const s = createFlagNoteSystem();
    const a = addFlagNote(s, 'A');
    const b = addFlagNote(s, 'B');
    expect(a.number).toBe(1);
    expect(b.number).toBe(2);
  });

  it('stores category when provided', () => {
    const s = createFlagNoteSystem();
    const n = addFlagNote(s, 'Heat treat', 'process');
    expect(n.category).toBe('process');
  });

  it('omits category when not provided', () => {
    const s = createFlagNoteSystem();
    const n = addFlagNote(s, 'A');
    expect(n.category).toBeUndefined();
  });
});

describe('removeFlagNote', () => {
  it('removes by number', () => {
    const s = createFlagNoteSystem();
    addFlagNote(s, 'A');
    addFlagNote(s, 'B');
    expect(removeFlagNote(s, 1)).toBe(true);
    expect(s.notes).toHaveLength(1);
  });

  it('returns false if number not found', () => {
    const s = createFlagNoteSystem();
    expect(removeFlagNote(s, 99)).toBe(false);
  });
});

describe('getFlagNote / anchorFlagNote', () => {
  it('finds by number', () => {
    const s = createFlagNoteSystem();
    addFlagNote(s, 'A');
    expect(getFlagNote(s, 1)?.text).toBe('A');
  });

  it('anchors flag to feature with sheet/zone', () => {
    const s = createFlagNoteSystem();
    addFlagNote(s, 'A');
    expect(anchorFlagNote(s, 1, { featureId: 'F1', sheet: 1, zone: 'A4' })).toBe(true);
    expect(s.notes[0]!.anchors).toHaveLength(1);
  });

  it('returns false for unknown flag', () => {
    const s = createFlagNoteSystem();
    expect(anchorFlagNote(s, 99, { featureId: 'F1' })).toBe(false);
  });
});

describe('renumberFlags', () => {
  it('sequential renumbers to 1..N', () => {
    const s = createFlagNoteSystem();
    addFlagNote(s, 'A');
    addFlagNote(s, 'B');
    removeFlagNote(s, 1);
    addFlagNote(s, 'C'); // becomes 3
    const map = renumberFlags(s, { mode: 'sequential' });
    expect(s.notes.map(n => n.number)).toEqual([1, 2]);
    expect(map.size).toBeGreaterThan(0);
  });

  it('fill-gaps does not change existing', () => {
    const s = createFlagNoteSystem();
    addFlagNote(s, 'A');
    addFlagNote(s, 'B');
    removeFlagNote(s, 1);
    renumberFlags(s, { mode: 'fill-gaps' });
    // Only flag 2 remains; nextNumber should jump to 1 (gap filled).
    expect(s.nextNumber).toBe(1);
  });
});

describe('validateFlagSystem', () => {
  it('flags empty text as error', () => {
    const s = createFlagNoteSystem();
    addFlagNote(s, '');
    const issues = validateFlagSystem(s);
    expect(issues.some(i => i.severity === 'error')).toBe(true);
  });

  it('flags unused notes as warn', () => {
    const s = createFlagNoteSystem();
    addFlagNote(s, 'A'); // no anchors
    const issues = validateFlagSystem(s);
    expect(issues.some(i => i.severity === 'warn')).toBe(true);
  });

  it('no issues for valid system', () => {
    const s = createFlagNoteSystem();
    addFlagNote(s, 'A');
    anchorFlagNote(s, 1, { featureId: 'F1' });
    expect(validateFlagSystem(s).some(i => i.severity === 'error')).toBe(false);
  });
});

describe('whereUsed', () => {
  it('aggregates sheets and zones', () => {
    const s = createFlagNoteSystem();
    addFlagNote(s, 'A');
    anchorFlagNote(s, 1, { featureId: 'F1', sheet: 1, zone: 'A4' });
    anchorFlagNote(s, 1, { featureId: 'F2', sheet: 2, zone: 'B3' });
    const xref = whereUsed(s);
    expect(xref[0]!.sheets).toEqual([1, 2]);
    expect(xref[0]!.zones).toEqual(['A4', 'B3']);
    expect(xref[0]!.totalAnchors).toBe(2);
  });
});

describe('defaultRenderHint', () => {
  it('uses larger triangle for critical categories', () => {
    const s = createFlagNoteSystem();
    const inspNote = addFlagNote(s, 'INSP', 'inspection');
    const matNote = addFlagNote(s, 'MAT', 'material');
    expect(defaultRenderHint(inspNote).triangleSizeMm).toBeGreaterThan(defaultRenderHint(matNote).triangleSizeMm);
  });

  it('drawLeader false when no anchors', () => {
    const s = createFlagNoteSystem();
    const n = addFlagNote(s, 'A');
    expect(defaultRenderHint(n).drawLeader).toBe(false);
  });
});

describe('summarize', () => {
  it('counts flags, anchors, unused', () => {
    const s = createFlagNoteSystem();
    addFlagNote(s, 'A', 'inspection');
    addFlagNote(s, 'B', 'material');
    anchorFlagNote(s, 1, { featureId: 'F1' });
    // flag 2 has no anchor → unused
    const sum = summarize(s);
    expect(sum.flagCount).toBe(2);
    expect(sum.totalAnchors).toBe(1);
    expect(sum.unusedFlags).toBe(1);
    expect(sum.byCategory['inspection']).toBe(1);
    expect(sum.byCategory['material']).toBe(1);
  });

  it('empty system summary', () => {
    const sum = summarize(createFlagNoteSystem());
    expect(sum.flagCount).toBe(0);
    expect(sum.totalAnchors).toBe(0);
  });
});
