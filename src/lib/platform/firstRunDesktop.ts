import { PREF_KEYS, prefGetString, prefRemove, prefSetString } from './settings';

/**
 * Manual QA (Tauri): fresh profile → wizard shows → Finish/Skip → relaunch no wizard;
 * File → replay tour → wizard from step 1 → Finish persists opt-in to PostHog gate in analytics.
 */

export function isDesktopFirstRunComplete(): boolean {
  return prefGetString(PREF_KEYS.desktopFirstRunDone) === '1';
}

export function markDesktopFirstRunComplete(): void {
  prefSetString(PREF_KEYS.desktopFirstRunDone, '1');
}

/** File → “Welcome tour again” — clears completion so the wizard shows on next paint. */
export function resetDesktopFirstRun(): void {
  prefRemove(PREF_KEYS.desktopFirstRunDone);
}

export function getTelemetryOptIn(): boolean {
  return prefGetString(PREF_KEYS.telemetryOptIn) === '1';
}

export function setTelemetryOptIn(optIn: boolean): void {
  prefSetString(PREF_KEYS.telemetryOptIn, optIn ? '1' : '0');
}
