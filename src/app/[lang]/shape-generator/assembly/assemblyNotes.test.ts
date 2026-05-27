import { describe, it, expect } from 'vitest';
import {
  createNotesState,
  addNote,
  updateNote,
  deleteNote,
  setStatus,
  filterNotes,
  sortBySeverity,
  sortByDate,
  SEVERITY_DISPLAY,
  summarize,
  type AssemblyNote,
} from './assemblyNotes';

function basicNote(): Omit<AssemblyNote, 'id' | 'createdAt'> {
  return {
    text: 'test',
    category: 'note',
    severity: 'info',
    status: 'open',
    bodyId: null,
  };
}

describe('addNote', () => {
  it('creates a note with auto id + timestamp', () => {
    const state = createNotesState();
    const n = addNote(state, basicNote());
    expect(n.id).toMatch(/^note-/);
    expect(n.createdAt).toBeGreaterThan(0);
  });

  it('stored in state', () => {
    const state = createNotesState();
    const n = addNote(state, basicNote());
    expect(state.notes.get(n.id)).toBeDefined();
  });
});

describe('updateNote', () => {
  it('updates fields', () => {
    const state = createNotesState();
    const n = addNote(state, basicNote());
    updateNote(state, n.id, { text: 'updated' });
    expect(state.notes.get(n.id)!.text).toBe('updated');
  });

  it('returns false on unknown id', () => {
    expect(updateNote(createNotesState(), 'ghost', {})).toBe(false);
  });
});

describe('deleteNote', () => {
  it('removes note', () => {
    const state = createNotesState();
    const n = addNote(state, basicNote());
    expect(deleteNote(state, n.id)).toBe(true);
    expect(state.notes.has(n.id)).toBe(false);
  });
});

describe('setStatus', () => {
  it('changes status', () => {
    const state = createNotesState();
    const n = addNote(state, basicNote());
    setStatus(state, n.id, 'resolved');
    expect(state.notes.get(n.id)!.status).toBe('resolved');
  });
});

describe('filterNotes', () => {
  it('filters by category', () => {
    const state = createNotesState();
    addNote(state, { ...basicNote(), category: 'safety' });
    addNote(state, { ...basicNote(), category: 'service' });
    expect(filterNotes(state, { category: 'safety' })).toHaveLength(1);
  });

  it('filters by status', () => {
    const state = createNotesState();
    addNote(state, basicNote());
    const open = addNote(state, basicNote());
    setStatus(state, open.id, 'resolved');
    expect(filterNotes(state, { status: 'resolved' })).toHaveLength(1);
  });

  it('filters by bodyId', () => {
    const state = createNotesState();
    addNote(state, { ...basicNote(), bodyId: 'A' });
    addNote(state, { ...basicNote(), bodyId: 'B' });
    expect(filterNotes(state, { bodyId: 'A' })).toHaveLength(1);
  });

  it('filters by tag', () => {
    const state = createNotesState();
    addNote(state, { ...basicNote(), tags: ['urgent'] });
    addNote(state, basicNote());
    expect(filterNotes(state, { tag: 'urgent' })).toHaveLength(1);
  });
});

describe('sortBySeverity + sortByDate', () => {
  it('critical comes before info', () => {
    const state = createNotesState();
    addNote(state, { ...basicNote(), severity: 'info' });
    addNote(state, { ...basicNote(), severity: 'critical' });
    const sorted = sortBySeverity([...state.notes.values()]);
    expect(sorted[0]!.severity).toBe('critical');
  });

  it('descending date by default', () => {
    const state = createNotesState();
    const old = addNote(state, basicNote());
    old.createdAt = 1000;
    const newer = addNote(state, basicNote());
    newer.createdAt = 2000;
    const sorted = sortByDate([...state.notes.values()]);
    expect(sorted[0]!.id).toBe(newer.id);
  });
});

describe('SEVERITY_DISPLAY', () => {
  it('critical color is red', () => {
    expect(SEVERITY_DISPLAY.critical.color).toBe('#FF0000');
  });

  it('all severities have a symbol', () => {
    expect(SEVERITY_DISPLAY.info.symbol).toBeTruthy();
    expect(SEVERITY_DISPLAY.warning.symbol).toBeTruthy();
  });
});

describe('summarize', () => {
  it('empty', () => {
    const s = summarize(createNotesState());
    expect(s.total).toBe(0);
  });

  it('counts by status + critical', () => {
    const state = createNotesState();
    addNote(state, { ...basicNote(), severity: 'critical' });
    const resolved = addNote(state, basicNote());
    setStatus(state, resolved.id, 'resolved');
    const s = summarize(state);
    expect(s.criticalCount).toBe(1);
    expect(s.resolvedCount).toBe(1);
  });

  it('byCategory totals', () => {
    const state = createNotesState();
    addNote(state, { ...basicNote(), category: 'safety' });
    addNote(state, { ...basicNote(), category: 'safety' });
    const s = summarize(state);
    expect(s.byCategory.safety).toBe(2);
  });
});
