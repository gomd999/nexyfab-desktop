'use client';

/**
 * User Part Library — localStorage-backed store for user-saved components.
 * A "part" is a snapshot of (shapeId, params, optional feature graph JSON, thumbnail).
 */

const STORAGE_KEY = 'nexyfab-user-parts-v1';
const MAX_PARTS = 200;

export interface UserPart {
  id: string;
  name: string;
  shapeId: string;
  params: Record<string, number>;
  featureGraphJson?: string;
  thumbnail?: string;          // data URL
  tags?: string[];
  description?: string;
  createdAt: number;
  updatedAt: number;
}

export interface UserPartsLibrary {
  parts: UserPart[];
}

function safeParse(raw: string | null): UserPartsLibrary {
  if (!raw) return { parts: [] };
  try {
    const obj = JSON.parse(raw);
    if (obj && Array.isArray(obj.parts)) return obj as UserPartsLibrary;
  } catch { /* ignore */ }
  return { parts: [] };
}

export function loadUserParts(): UserPart[] {
  if (typeof localStorage === 'undefined') return [];
  return safeParse(localStorage.getItem(STORAGE_KEY)).parts;
}

export function saveUserParts(parts: UserPart[]): void {
  if (typeof localStorage === 'undefined') return;
  const trimmed = parts.slice(-MAX_PARTS);
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ parts: trimmed }));
}

export function addUserPart(part: Omit<UserPart, 'id' | 'createdAt' | 'updatedAt'>): UserPart {
  const now = Date.now();
  const newPart: UserPart = {
    ...part,
    id: `upart-${now}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: now,
    updatedAt: now,
  };
  const existing = loadUserParts();
  const next = [...existing, newPart];
  saveUserParts(next);
  return newPart;
}

export function updateUserPart(id: string, patch: Partial<UserPart>): UserPart | null {
  const existing = loadUserParts();
  const idx = existing.findIndex(p => p.id === id);
  if (idx === -1) return null;
  const updated = { ...existing[idx], ...patch, id, updatedAt: Date.now() };
  const next = [...existing];
  next[idx] = updated;
  saveUserParts(next);
  return updated;
}

export function deleteUserPart(id: string): void {
  saveUserParts(loadUserParts().filter(p => p.id !== id));
}

export function exportUserPartsJSON(): string {
  return JSON.stringify({ parts: loadUserParts(), exportedAt: new Date().toISOString() }, null, 2);
}

export function importUserPartsJSON(json: string, mode: 'merge' | 'replace' = 'merge'): number {
  try {
    const parsed = JSON.parse(json);
    const incoming: UserPart[] = Array.isArray(parsed?.parts) ? parsed.parts : [];
    if (incoming.length === 0) return 0;
    const valid = incoming.filter(p => p && typeof p.id === 'string' && typeof p.shapeId === 'string');
    if (mode === 'replace') {
      saveUserParts(valid);
      return valid.length;
    }
    const existing = loadUserParts();
    const byId = new Map(existing.map(p => [p.id, p]));
    valid.forEach(p => byId.set(p.id, p));
    saveUserParts([...byId.values()]);
    return valid.length;
  } catch {
    return 0;
  }
}
