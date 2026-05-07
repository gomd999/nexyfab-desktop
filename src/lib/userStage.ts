/**
 * Client-safe Stage types and `nf_users.stage` / JWT column parsing.
 * No DB or Node-only modules — import from here in `'use client'` hooks.
 * Full evaluation rules: `stage-engine.ts` (server / API routes).
 */

export type Stage = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

/** `nf_users.stage` / JWT 외부 값을 Stage 도메인으로 정규화. */
export function parseUserStageColumn(raw: unknown): Stage {
  const s = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  if (s === 'A' || s === 'B' || s === 'C' || s === 'D' || s === 'E' || s === 'F') return s;
  return 'A';
}
