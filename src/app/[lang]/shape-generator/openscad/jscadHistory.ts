/**
 * jscadHistory.ts — localStorage 기반 JSCAD 생성 이력 (최대 20개)
 */

export interface JscadHistoryItem {
  id: string;
  prompt: string;
  code: string;
  description: string;
  triCount: number;
  createdAt: string; // ISO string
}

const KEY = 'nf_jscad_history';
const MAX = 20;

export function loadHistory(): JscadHistoryItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    return JSON.parse(raw) as JscadHistoryItem[];
  } catch {
    return [];
  }
}

export function saveToHistory(item: Omit<JscadHistoryItem, 'id' | 'createdAt'>): JscadHistoryItem {
  const entry: JscadHistoryItem = {
    ...item,
    id: `jscad-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(),
  };
  const history = loadHistory();
  // 동일 프롬프트 중복 제거 후 앞에 추가
  const deduped = history.filter(h => h.prompt !== item.prompt);
  const next = [entry, ...deduped].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
  return entry;
}

export function deleteFromHistory(id: string) {
  const history = loadHistory().filter(h => h.id !== id);
  try { localStorage.setItem(KEY, JSON.stringify(history)); } catch {}
}

export function clearHistory() {
  try { localStorage.removeItem(KEY); } catch {}
}
