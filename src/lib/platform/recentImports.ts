import { PREF_KEYS, prefGetJson, prefSetJson } from './settings';

export type RecentImportEntry = { name: string; ext: string; size?: number; date: number };

export function getRecentImportFiles(): RecentImportEntry[] {
  return prefGetJson<RecentImportEntry[]>(PREF_KEYS.recentImportFiles) ?? [];
}

export function upsertRecentImportFile(entry: RecentImportEntry): void {
  const recent = getRecentImportFiles();
  const updated = [entry, ...recent.filter((r) => r.name !== entry.name)].slice(0, 5);
  prefSetJson(PREF_KEYS.recentImportFiles, updated);
}
