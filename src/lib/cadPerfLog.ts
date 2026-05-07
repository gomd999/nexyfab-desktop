/**
 * Opt-in CAD operation timing for field diagnostics (`NEXT_PUBLIC_CAD_PERF=1`).
 */
export function cadPerfEnabled(): boolean {
  return process.env.NEXT_PUBLIC_CAD_PERF === '1' || process.env.NEXT_PUBLIC_CAD_PERF === 'true';
}

export function cadPerfLog(
  category: string,
  durationMs: number,
  extra?: Record<string, string | number | boolean>,
): void {
  if (!cadPerfEnabled()) return;
  const raw = process.env.NEXT_PUBLIC_CAD_PERF_SAMPLE ?? '1';
  const rate = Math.min(1, Math.max(0, parseFloat(raw)));
  if (Number.isFinite(rate) && rate < 1 && Math.random() > rate) return;
  try {
    const payload = { category, ms: Math.round(durationMs * 100) / 100, ...extra };
    console.info('[cad-perf]', JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}
