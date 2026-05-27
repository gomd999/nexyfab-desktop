/**
 * assemblyNotes.ts — Text annotations attached to assembly bodies
 * or 3D points.
 *
 * Engineers annotate assemblies with notes like "torque to 25 N·m",
 * "apply Loctite 243", "see service manual §4.3". Notes live with
 * the assembly file and appear as floating callouts in 3D + listed
 * in the assembly notes panel.
 *
 * Module handles:
 *
 *   - Create / update / delete notes.
 *   - Filter by body, by category (assembly / service / safety), by
 *     status (open / resolved / obsolete).
 *   - Severity icons + sorting by severity then date.
 */

export type NoteCategory = 'assembly' | 'service' | 'safety' | 'inspection' | 'note';
export type NoteSeverity = 'info' | 'caution' | 'warning' | 'critical';
export type NoteStatus = 'open' | 'resolved' | 'obsolete';

export interface Vec3 { x: number; y: number; z: number }

export interface AssemblyNote {
  id: string;
  /** Free-form text. */
  text: string;
  category: NoteCategory;
  severity: NoteSeverity;
  status: NoteStatus;
  /** Body id this note is attached to (null = floating). */
  bodyId: string | null;
  /** Optional anchor point in 3D space. */
  anchor?: Vec3;
  /** Creation timestamp (ms since epoch). */
  createdAt: number;
  /** Optional author. */
  author?: string;
  /** Optional tags. */
  tags?: string[];
}

export interface NotesState {
  notes: Map<string, AssemblyNote>;
}

// ── Construction ───────────────────────────────────────────────

export function createNotesState(): NotesState {
  return { notes: new Map() };
}

// ── CRUD ──────────────────────────────────────────────────────

let nextId = 1;

export function addNote(state: NotesState, partial: Omit<AssemblyNote, 'id' | 'createdAt'>): AssemblyNote {
  const note: AssemblyNote = {
    ...partial,
    id: `note-${nextId++}`,
    createdAt: Date.now(),
  };
  state.notes.set(note.id, note);
  return note;
}

export function updateNote(state: NotesState, id: string, update: Partial<Omit<AssemblyNote, 'id' | 'createdAt'>>): boolean {
  const note = state.notes.get(id);
  if (!note) return false;
  Object.assign(note, update);
  return true;
}

export function deleteNote(state: NotesState, id: string): boolean {
  return state.notes.delete(id);
}

export function setStatus(state: NotesState, id: string, status: NoteStatus): boolean {
  return updateNote(state, id, { status });
}

// ── Filters ────────────────────────────────────────────────────

export interface NoteFilter {
  bodyId?: string;
  category?: NoteCategory;
  severity?: NoteSeverity;
  status?: NoteStatus;
  tag?: string;
  author?: string;
}

export function filterNotes(state: NotesState, filter: NoteFilter): AssemblyNote[] {
  const out: AssemblyNote[] = [];
  for (const note of state.notes.values()) {
    if (filter.bodyId !== undefined && note.bodyId !== filter.bodyId) continue;
    if (filter.category !== undefined && note.category !== filter.category) continue;
    if (filter.severity !== undefined && note.severity !== filter.severity) continue;
    if (filter.status !== undefined && note.status !== filter.status) continue;
    if (filter.tag !== undefined && !(note.tags ?? []).includes(filter.tag)) continue;
    if (filter.author !== undefined && note.author !== filter.author) continue;
    out.push(note);
  }
  return out;
}

// ── Sorting ────────────────────────────────────────────────────

const SEVERITY_RANK: Record<NoteSeverity, number> = {
  critical: 3, warning: 2, caution: 1, info: 0,
};

export function sortBySeverity(notes: AssemblyNote[]): AssemblyNote[] {
  return [...notes].sort((a, b) =>
    SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.createdAt - a.createdAt,
  );
}

export function sortByDate(notes: AssemblyNote[], descending: boolean = true): AssemblyNote[] {
  return [...notes].sort((a, b) => descending ? b.createdAt - a.createdAt : a.createdAt - b.createdAt);
}

// ── Severity icons ────────────────────────────────────────────

export interface SeverityDisplay {
  symbol: string;
  color: string;
}

export const SEVERITY_DISPLAY: Record<NoteSeverity, SeverityDisplay> = {
  info: { symbol: 'ℹ', color: '#0080FF' },
  caution: { symbol: '⚠', color: '#FFCC00' },
  warning: { symbol: '⚠', color: '#FF8000' },
  critical: { symbol: '✕', color: '#FF0000' },
};

// ── Summary ────────────────────────────────────────────────────

export interface NotesSummary {
  total: number;
  openCount: number;
  resolvedCount: number;
  criticalCount: number;
  byCategory: Record<NoteCategory, number>;
}

export function summarize(state: NotesState): NotesSummary {
  const byCategory: Record<NoteCategory, number> = {
    assembly: 0, service: 0, safety: 0, inspection: 0, note: 0,
  };
  let open = 0, resolved = 0, critical = 0;
  for (const note of state.notes.values()) {
    byCategory[note.category]++;
    if (note.status === 'open') open++;
    if (note.status === 'resolved') resolved++;
    if (note.severity === 'critical') critical++;
  }
  return {
    total: state.notes.size,
    openCount: open,
    resolvedCount: resolved,
    criticalCount: critical,
    byCategory,
  };
}
