/** Persists user preference to hide performance-oriented info toasts (CAM heavy mesh, interference run, large sketch constraints). */

const STORAGE_KEY = 'nf_suppress_cad_perf_toasts_v1';

export function getSuppressCadPerfToasts(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setSuppressCadPerfToasts(value: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (value) window.localStorage.setItem(STORAGE_KEY, '1');
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* quota / private mode */
  }
}
