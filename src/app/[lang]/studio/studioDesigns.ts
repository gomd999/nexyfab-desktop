/**
 * studioDesigns — local persistence for Studio creations so the sidebar can
 * show a ChatGPT/Gemini-style "recent designs" history and the user can return
 * to and keep iterating on past models. Browser-local (works for guests and
 * logged-in users); cross-device sync via the account is a future enhancement.
 *
 * Pure CRUD over localStorage — headless-testable by injecting a Storage.
 */

export interface StudioChatMsg {
  role: 'user' | 'assistant';
  text: string;
  image?: string | null;
  thumb?: string | null;
  status?: 'thinking' | 'done' | 'error';
}

export interface StudioDesign {
  id: string;
  title: string;
  scad: string;
  messages: StudioChatMsg[];
  thumb?: string | null;
  updatedAt: number;
}

const KEY = 'nexyfab:studio-designs';
const MAX = 40;

// Designs are browser-local but scoped per account so a shared browser doesn't
// leak one user's (or a guest's) recent designs into another account. The
// caller (StudioInner) sets the scope to the logged-in user id, or 'guest'.
let currentScope = 'guest';
export function setDesignScope(userId: string | null | undefined): void {
  currentScope = userId && userId.trim() ? `u:${userId.trim()}` : 'guest';
}
function keyFor(): string {
  return `${KEY}:${currentScope}`;
}

// One-time migration: older builds stored everything under the unscoped KEY.
// Move it into the 'guest' bucket (unknown owner — never attribute to an
// account) and drop the legacy key, so it stops showing for logged-in users.
let migrated = false;
function migrateLegacy(s: Storage): void {
  if (migrated) return;
  migrated = true;
  try {
    const legacy = s.getItem(KEY);
    if (legacy) {
      if (!s.getItem(`${KEY}:guest`)) s.setItem(`${KEY}:guest`, legacy);
      s.removeItem(KEY);
    }
  } catch { /* ignore */ }
}

function store(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** All designs, newest first. */
export function listDesigns(s: Storage | null = store()): StudioDesign[] {
  if (!s) return [];
  migrateLegacy(s);
  try {
    const raw = s.getItem(keyFor());
    if (!raw) return [];
    const arr = JSON.parse(raw) as StudioDesign[];
    if (!Array.isArray(arr)) return [];
    return arr.slice().sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export function getDesign(id: string, s: Storage | null = store()): StudioDesign | null {
  return listDesigns(s).find(d => d.id === id) ?? null;
}

/** Insert or update a design (matched by id), keeping the list capped + sorted. */
export function saveDesign(design: StudioDesign, s: Storage | null = store()): void {
  if (!s) return;
  try {
    const all = listDesigns(s).filter(d => d.id !== design.id);
    all.unshift(design);
    const capped = all
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX);
    s.setItem(keyFor(), JSON.stringify(capped));
  } catch {
    // Quota / serialization failure — history is best-effort, never block.
  }
}

export function deleteDesign(id: string, s: Storage | null = store()): void {
  if (!s) return;
  try {
    const all = listDesigns(s).filter(d => d.id !== id);
    s.setItem(keyFor(), JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

/** Derive a short title from the first user message. */
export function titleFromMessages(messages: StudioChatMsg[]): string {
  const first = messages.find(m => m.role === 'user' && m.text.trim());
  const t = (first?.text ?? '').trim().replace(/\s+/g, ' ');
  if (!t || t === '(이미지)' || t === '(image)') return '🖼️ Image design';
  return t.length > 40 ? t.slice(0, 40) + '…' : t;
}
