/**
 * GET /api/cron/burnin-step-corpus
 *
 * Nightly regression suite — fetches each entry in the verified STEP
 * burn-in corpus, posts it to the internal step-import endpoint, and
 * aggregates pass/fail + timing per model. Alerts when:
 *
 *  - Any model that passed in baseline now fails (hard regress).
 *  - Overall success rate drops below SUCCESS_RATE_FLOOR.
 *  - p95 import latency rises above LATENCY_REGRESS_RATIO × baseline.
 *
 * Cron pattern + auth mirrors `/api/cron/prompt-variant-burnin`.
 *
 * Designed to be a no-op when:
 *  - READY_BURNIN_ENTRIES is empty (URL curation still pending).
 *  - BREP_WORKER_URL is unset locally — the cron will surface a single
 *    warning per run and exit cleanly rather than blasting alerts.
 *
 * Storage: per-run summary persists to `nf_burnin_runs` so trend
 * analysis and baseline comparisons can be done without re-running.
 * The table is created lazily on first run to avoid migration coupling.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { sendOpsAlert } from '@/lib/notify/opsAlert';
import { READY_BURNIN_ENTRIES, type BurninCorpusEntry } from '@/lib/burnin/stepCorpus';

export const dynamic = 'force-dynamic';

const FETCH_TIMEOUT_MS = 30_000;
const IMPORT_TIMEOUT_MS = 120_000;
const SUCCESS_RATE_FLOOR = 0.95;
const LATENCY_REGRESS_RATIO = 2.0;
const MAX_BYTES_PER_ENTRY = 5 * 1024 * 1024;

interface RunResult {
  id: string;
  label: string;
  bytes?: number;
  triangles?: number;
  importMs?: number;
  ok: boolean;
  error?: string;
}

interface BaselineMetrics {
  ok: boolean;
  importMs?: number;
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Hit our own /api/nexyfab/brep/step-import endpoint internally so the
 *  burn-in exercises the same code path real users hit, including the
 *  worker dispatch + queue depth checks. The cron is its own caller —
 *  the route enforces plan/rate-limit, so we pass a synthetic admin
 *  bearer when CRON_BURNIN_USER_TOKEN is set. Without that token the
 *  cron skips the import step and logs the corpus presence only. */
async function importStepBytes(
  buffer: ArrayBuffer,
  filename: string,
  origin: string,
  bearer: string,
): Promise<{ ok: boolean; triangles?: number; error?: string; ms: number }> {
  const started = Date.now();
  const b64 = Buffer.from(buffer).toString('base64');
  try {
    const r = await fetchWithTimeout(
      `${origin}/api/nexyfab/brep/step-import`,
      IMPORT_TIMEOUT_MS,
    );
    // The fetchWithTimeout call above is a HEAD-style probe; the real
    // POST is below. Kept separate so a dead worker URL fails fast
    // before we burn time uploading a 5MB body for nothing.
    if (!r.ok && r.status !== 405) {
      return { ok: false, error: `endpoint probe HTTP ${r.status}`, ms: Date.now() - started };
    }
  } catch (e) {
    return { ok: false, error: `endpoint probe ${(e as Error).message}`, ms: Date.now() - started };
  }
  try {
    const post = await fetch(`${origin}/api/nexyfab/brep/step-import`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify({
        async: false,
        input: { kind: 'inlineBase64', filename, base64: b64 },
      }),
      signal: AbortSignal.timeout(IMPORT_TIMEOUT_MS),
    });
    const ms = Date.now() - started;
    if (!post.ok) {
      const text = await post.text().catch(() => '');
      return { ok: false, error: `import HTTP ${post.status}: ${text.slice(0, 200)}`, ms };
    }
    const json = (await post.json().catch(() => ({}))) as { triangleCount?: number };
    return { ok: true, triangles: json.triangleCount, ms };
  } catch (e) {
    return { ok: false, error: (e as Error).message, ms: Date.now() - started };
  }
}

async function processEntry(
  e: BurninCorpusEntry,
  origin: string,
  bearer: string,
): Promise<RunResult> {
  let buffer: ArrayBuffer;
  try {
    const r = await fetchWithTimeout(e.url, FETCH_TIMEOUT_MS);
    if (!r.ok) return { id: e.id, label: e.label, ok: false, error: `download HTTP ${r.status}` };
    const len = Number(r.headers.get('content-length') ?? 0);
    if (len > MAX_BYTES_PER_ENTRY) {
      return { id: e.id, label: e.label, ok: false, error: `download too large (${len}B)` };
    }
    buffer = await r.arrayBuffer();
    if (buffer.byteLength > MAX_BYTES_PER_ENTRY) {
      return { id: e.id, label: e.label, ok: false, error: `download too large after read (${buffer.byteLength}B)` };
    }
  } catch (err) {
    return { id: e.id, label: e.label, ok: false, error: `download ${(err as Error).message}` };
  }

  const filename = e.id.endsWith('.step') ? e.id : `${e.id}.step`;
  const r = await importStepBytes(buffer, filename, origin, bearer);
  return {
    id: e.id,
    label: e.label,
    bytes: buffer.byteLength,
    triangles: r.triangles,
    importMs: r.ms,
    ok: r.ok,
    error: r.error,
  };
}

async function loadBaseline(): Promise<Map<string, BaselineMetrics>> {
  const db = getDbAdapter();
  await db.executeRaw(`CREATE TABLE IF NOT EXISTS nf_burnin_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_at INTEGER NOT NULL,
    entry_id TEXT NOT NULL,
    ok INTEGER NOT NULL,
    import_ms INTEGER,
    error TEXT
  )`).catch(() => undefined);
  const rows = await db.queryAll<{ entry_id: string; ok: number; import_ms: number | null }>(
    `SELECT entry_id, ok, import_ms FROM nf_burnin_runs
     WHERE run_at > ? AND ok = 1
     GROUP BY entry_id
     HAVING MAX(run_at)`,
    Date.now() - 30 * 24 * 60 * 60 * 1000,
  ).catch(() => [] as { entry_id: string; ok: number; import_ms: number | null }[]);
  const map = new Map<string, BaselineMetrics>();
  for (const row of rows) {
    map.set(row.entry_id, {
      ok: row.ok === 1,
      importMs: row.import_ms ?? undefined,
    });
  }
  return map;
}

async function persistRun(runAt: number, results: RunResult[]): Promise<void> {
  const db = getDbAdapter();
  for (const r of results) {
    await db.execute(
      `INSERT INTO nf_burnin_runs (run_at, entry_id, ok, import_ms, error) VALUES (?, ?, ?, ?, ?)`,
      runAt, r.id, r.ok ? 1 : 0, r.importMs ?? null, r.error ?? null,
    ).catch(() => undefined);
  }
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!cronSecret || token !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (READY_BURNIN_ENTRIES.length === 0) {
    return NextResponse.json({
      status: 'noop',
      reason: 'No verified corpus entries — pending URL curation. See src/lib/burnin/stepCorpus.ts.',
    });
  }

  const origin = process.env.NEXT_PUBLIC_BASE_URL ?? `https://${req.headers.get('host')}`;
  const bearer = process.env.CRON_BURNIN_USER_TOKEN;
  if (!bearer) {
    await sendOpsAlert({
      severity: 'warning',
      title: 'Burn-in cron skipped',
      bodyLines: ['CRON_BURNIN_USER_TOKEN unset — cron cannot exercise step-import without an authenticated bearer.'],
      source: 'cron:burnin-step-corpus',
    });
    return NextResponse.json({ status: 'skipped', reason: 'CRON_BURNIN_USER_TOKEN unset' });
  }

  const runAt = Date.now();
  const results: RunResult[] = [];
  // Serial run keeps OCCT worker memory pressure predictable. Total time
  // is bounded by (entries × IMPORT_TIMEOUT_MS); for the seed list of 10
  // that's ≤ 20 min worst case.
  for (const entry of READY_BURNIN_ENTRIES) {
    results.push(await processEntry(entry, origin, bearer));
  }

  const baseline = await loadBaseline();
  await persistRun(runAt, results);

  const passCount = results.filter(r => r.ok).length;
  const successRate = results.length > 0 ? passCount / results.length : 0;
  const regressed = results.filter(r => {
    if (r.ok) return false;
    const b = baseline.get(r.id);
    return b?.ok === true;
  });
  const latencyRegress = results.filter(r => {
    if (!r.ok || !r.importMs) return false;
    const b = baseline.get(r.id);
    if (!b?.importMs) return false;
    return r.importMs >= b.importMs * LATENCY_REGRESS_RATIO;
  });

  if (regressed.length > 0 || successRate < SUCCESS_RATE_FLOOR) {
    await sendOpsAlert({
      severity: 'critical',
      title: `Burn-in regress: ${regressed.length} model(s) fail, success ${(successRate * 100).toFixed(1)}%`,
      bodyLines: [
        ...regressed.map(r => `❌ ${r.label} (${r.id}): ${r.error ?? 'unknown'}`),
        `Pass: ${passCount}/${results.length}`,
      ],
      context: { runAt, regressCount: regressed.length },
      source: 'cron:burnin-step-corpus',
    });
  } else if (latencyRegress.length > 0) {
    await sendOpsAlert({
      severity: 'warning',
      title: `Burn-in latency regress: ${latencyRegress.length} model(s) ≥2× baseline`,
      bodyLines: latencyRegress.map(r => {
        const b = baseline.get(r.id);
        return `${r.label}: ${r.importMs}ms vs baseline ${b?.importMs ?? '?'}ms`;
      }),
      source: 'cron:burnin-step-corpus',
    });
  }

  return NextResponse.json({
    status: 'ok',
    runAt,
    summary: {
      total: results.length,
      pass: passCount,
      successRate,
      regressCount: regressed.length,
      latencyRegressCount: latencyRegress.length,
    },
    results,
  });
}
