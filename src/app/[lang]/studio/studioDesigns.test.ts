import { describe, it, expect, beforeEach } from 'vitest';
import { listDesigns, saveDesign, getDesign, deleteDesign, titleFromMessages, type StudioDesign } from './studioDesigns';

// Minimal in-memory Storage stub.
function memStore(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    removeItem: (k: string) => { m.delete(k); },
    setItem: (k: string, v: string) => { m.set(k, v); },
  } as Storage;
}

const d = (id: string, t: number, title = 'box'): StudioDesign =>
  ({ id, title, scad: `cube();// ${id}`, messages: [{ role: 'user', text: title }], updatedAt: t });

describe('studioDesigns', () => {
  let s: Storage;
  beforeEach(() => { s = memStore(); });

  it('save + list newest-first', () => {
    saveDesign(d('a', 100), s);
    saveDesign(d('b', 300), s);
    saveDesign(d('c', 200), s);
    expect(listDesigns(s).map(x => x.id)).toEqual(['b', 'c', 'a']);
  });

  it('save with same id updates (no duplicate)', () => {
    saveDesign(d('a', 100, 'old'), s);
    saveDesign(d('a', 400, 'new'), s);
    const all = listDesigns(s);
    expect(all).toHaveLength(1);
    expect(all[0]!.title).toBe('new');
  });

  it('getDesign returns the scad', () => {
    saveDesign(d('a', 1), s);
    expect(getDesign('a', s)!.scad).toContain('// a');
    expect(getDesign('zzz', s)).toBeNull();
  });

  it('deleteDesign removes it', () => {
    saveDesign(d('a', 1), s);
    saveDesign(d('b', 2), s);
    deleteDesign('a', s);
    expect(listDesigns(s).map(x => x.id)).toEqual(['b']);
  });

  it('caps the history at 40', () => {
    for (let i = 0; i < 50; i++) saveDesign(d(`id${i}`, i), s);
    expect(listDesigns(s)).toHaveLength(40);
    // newest kept
    expect(listDesigns(s)[0]!.id).toBe('id49');
  });

  it('null storage (SSR) → empty, no throw', () => {
    expect(listDesigns(null)).toEqual([]);
    expect(() => saveDesign(d('a', 1), null)).not.toThrow();
  });

  it('titleFromMessages derives a short title', () => {
    expect(titleFromMessages([{ role: 'user', text: 'a toy car with four wheels' }])).toBe('a toy car with four wheels');
    expect(titleFromMessages([{ role: 'user', text: '(image)' }])).toContain('Image');
    const long = 'x'.repeat(60);
    expect(titleFromMessages([{ role: 'user', text: long }]).endsWith('…')).toBe(true);
  });
});
