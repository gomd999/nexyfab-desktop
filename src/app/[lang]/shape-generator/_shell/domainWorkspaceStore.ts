'use client';

import { useEffect, useSyncExternalStore } from 'react';
import {
  DESIGN_DOMAIN_IDS,
  type DesignDomainId,
  type UserExperienceLevel,
} from '@/lib/ai/domainProfile';
import type { DesignWorkMode } from '@/lib/ai/designWorkspaceRevision';

export const DOMAIN_WORKSPACE_STORAGE_KEY = 'nexyfab:domain-workspace:v1';

export interface DomainWorkspaceSelection {
  domain: DesignDomainId;
  experience: UserExperienceLevel;
  workMode: DesignWorkMode;
}

type DomainWorkspaceSelectionInput = Omit<DomainWorkspaceSelection, 'workMode'> & { workMode?: DesignWorkMode };

export const DEFAULT_DOMAIN_WORKSPACE: DomainWorkspaceSelection = Object.freeze({
  domain: 'mechanical',
  experience: 'guided',
  workMode: 'ai_assisted',
});

let current: DomainWorkspaceSelection = DEFAULT_DOMAIN_WORKSPACE;
let hydrated = false;
const listeners = new Set<() => void>();

function normalizeSelection(value: unknown): DomainWorkspaceSelection | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<DomainWorkspaceSelection>;
  if (!DESIGN_DOMAIN_IDS.includes(candidate.domain as DesignDomainId)
    || (candidate.experience !== 'guided' && candidate.experience !== 'expert')
    || (candidate.workMode !== undefined && !['ai_assisted', 'manual', 'precision_cad'].includes(candidate.workMode))) return null;
  return {
    domain: candidate.domain as DesignDomainId,
    experience: candidate.experience,
    workMode: candidate.workMode ?? 'ai_assisted',
  };
}

function publish(next: DomainWorkspaceSelection, persist: boolean): void {
  if (next.domain === current.domain && next.experience === current.experience && next.workMode === current.workMode) return;
  current = Object.freeze({ ...next });
  if (persist && typeof window !== 'undefined') {
    try { window.sessionStorage.setItem(DOMAIN_WORKSPACE_STORAGE_KEY, JSON.stringify(current)); } catch { /* optional */ }
  }
  listeners.forEach(listener => listener());
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('nexyfab:domain-workspace-change', { detail: current }));
  }
}

export function hydrateDomainWorkspace(): void {
  if (hydrated || typeof window === 'undefined') return;
  hydrated = true;
  try {
    const parsed: unknown = JSON.parse(window.sessionStorage.getItem(DOMAIN_WORKSPACE_STORAGE_KEY) ?? 'null');
    const normalized = normalizeSelection(parsed);
    if (normalized) publish(normalized, false);
  } catch { /* invalid session data falls back to the safe default */ }
}

export function getDomainWorkspaceSelection(): DomainWorkspaceSelection {
  return current;
}

export function setDomainWorkspaceSelection(
  next: DomainWorkspaceSelectionInput | ((selection: DomainWorkspaceSelection) => DomainWorkspaceSelectionInput),
): void {
  const candidate = typeof next === 'function' ? next(current) : next;
  const normalized = normalizeSelection(candidate);
  if (!normalized) return;
  publish(normalized, true);
}

export function subscribeDomainWorkspace(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDomainWorkspaceSelection(): readonly [
  DomainWorkspaceSelection,
  typeof setDomainWorkspaceSelection,
] {
  const selection = useSyncExternalStore(
    subscribeDomainWorkspace,
    getDomainWorkspaceSelection,
    () => DEFAULT_DOMAIN_WORKSPACE,
  );
  useEffect(hydrateDomainWorkspace, []);
  return [selection, setDomainWorkspaceSelection] as const;
}

/** Test isolation helper; it deliberately does not touch protected project data. */
export function resetDomainWorkspaceSession(): void {
  hydrated = false;
  current = DEFAULT_DOMAIN_WORKSPACE;
  if (typeof window !== 'undefined') {
    try { window.sessionStorage.removeItem(DOMAIN_WORKSPACE_STORAGE_KEY); } catch { /* optional */ }
  }
  listeners.forEach(listener => listener());
}
