'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { DesignLockTarget } from '@/lib/ai/designWorkspaceRevision';
import type { FeatureEditLock } from './featureEditDispatcher';

export const MANUAL_EDIT_PROTECTION_STORAGE_KEY = 'nexyfab:manual-edit-protection:v1';

export interface RuntimeDesignLock extends FeatureEditLock {
  scope: string;
  source: 'human' | 'expert' | 'authority';
  reason: string;
  createdAt: string;
}

let current: readonly RuntimeDesignLock[] = Object.freeze([]);
let hydrated = false;
const listeners = new Set<() => void>();

function validTarget(value: unknown): value is DesignLockTarget {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<DesignLockTarget>;
  return typeof candidate.kind === 'string'
    && ['workspace', 'base_shape', 'assembly', 'occurrence', 'feature', 'parameter', 'authoritative_input'].includes(candidate.kind)
    && typeof candidate.objectId === 'string' && candidate.objectId.trim().length > 0
    && (candidate.field === undefined || (typeof candidate.field === 'string' && candidate.field.trim().length > 0));
}

function isLock(value: unknown): value is RuntimeDesignLock {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RuntimeDesignLock>;
  return typeof candidate.id === 'string' && candidate.id.trim().length > 0
    && validTarget(candidate.target)
    && (candidate.scope === undefined || (typeof candidate.scope === 'string' && candidate.scope.trim().length > 0))
    && (candidate.source === 'human' || candidate.source === 'expert' || candidate.source === 'authority')
    && typeof candidate.reason === 'string' && candidate.reason.trim().length > 0
    && typeof candidate.createdAt === 'string' && Number.isFinite(Date.parse(candidate.createdAt));
}

function publish(locks: readonly RuntimeDesignLock[], persist: boolean): void {
  current = Object.freeze(locks.map(lock => Object.freeze({ ...lock, target: Object.freeze({ ...lock.target }) })));
  if (persist && typeof window !== 'undefined') {
    try { window.sessionStorage.setItem(MANUAL_EDIT_PROTECTION_STORAGE_KEY, JSON.stringify(current)); } catch { /* optional */ }
  }
  listeners.forEach(listener => listener());
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('nexyfab:manual-edit-protection-change', { detail: current }));
}

export function hydrateManualEditProtection(): void {
  if (hydrated || typeof window === 'undefined') return;
  hydrated = true;
  try {
    const parsed: unknown = JSON.parse(window.sessionStorage.getItem(MANUAL_EDIT_PROTECTION_STORAGE_KEY) ?? 'null');
    if (Array.isArray(parsed) && parsed.every(isLock)) publish(parsed.map(lock => ({ ...lock, scope: lock.scope ?? 'local-workspace' })), false);
  } catch { /* invalid browser state is ignored */ }
}

export function getManualEditProtectionLocks(scope?: string): readonly RuntimeDesignLock[] {
  hydrateManualEditProtection();
  return scope ? current.filter(lock => lock.scope === scope) : current;
}

function lockId(scope: string, target: DesignLockTarget): string {
  return `manual:${encodeURIComponent(scope)}:${target.kind}:${encodeURIComponent(target.objectId)}:${encodeURIComponent(target.field ?? '')}`;
}

export function protectManualEdit(
  target: DesignLockTarget,
  options: { scope?: string; source?: RuntimeDesignLock['source']; reason?: string } = {},
): RuntimeDesignLock {
  hydrateManualEditProtection();
  if (!validTarget(target)) throw new Error('INVALID_MANUAL_EDIT_LOCK_TARGET');
  const scope = options.scope?.trim() || 'local-workspace';
  const lock: RuntimeDesignLock = {
    id: lockId(scope, target),
    target: { ...target },
    scope,
    source: options.source ?? 'human',
    reason: options.reason ?? 'User-entered value',
    createdAt: new Date().toISOString(),
  };
  publish([...current.filter(candidate => candidate.id !== lock.id), lock], true);
  return lock;
}

export function releaseManualEditProtection(lockIdToRelease: string): boolean {
  hydrateManualEditProtection();
  const next = current.filter(lock => lock.id !== lockIdToRelease);
  if (next.length === current.length) return false;
  publish(next, true);
  return true;
}

export function releaseAllManualEditProtections(): number {
  hydrateManualEditProtection();
  const released = current.length;
  if (released > 0) publish([], true);
  return released;
}

export function useManualEditProtectionLocks(scope?: string): readonly RuntimeDesignLock[] {
  const locks = useSyncExternalStore(
    listener => { listeners.add(listener); return () => listeners.delete(listener); },
    getManualEditProtectionLocks,
    () => Object.freeze([]),
  );
  useEffect(hydrateManualEditProtection, []);
  return useMemo(() => scope ? locks.filter(lock => lock.scope === scope) : locks, [locks, scope]);
}

/** Test-only isolation. Never touches project, account, or uploaded content. */
export function resetManualEditProtectionSession(): void {
  hydrated = false;
  current = Object.freeze([]);
  if (typeof window !== 'undefined') {
    try { window.sessionStorage.removeItem(MANUAL_EDIT_PROTECTION_STORAGE_KEY); } catch { /* optional */ }
  }
  listeners.forEach(listener => listener());
}
