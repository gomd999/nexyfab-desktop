/**
 * Π1 — Docker fetch adapter for the Σ simulation suite.
 *
 * Drop-in replacement for the mock adapters in `simulationAdapters.ts`.
 * Each Docker container exposes a tiny REST API on a known port, returning
 * the same shape as the corresponding `Sim*Output` interface. This adapter
 * forwards the agent's request to that container and surfaces progress.
 *
 * Container contract (must hold for all Σ kinds):
 *   POST /solve   { input: <kind input> }
 *     → 200 { jobId, status:'queued' }
 *   GET  /jobs/:id
 *     → 200 { jobId, status:'queued|running|done|failed', progress:0-1, result?, error? }
 *
 * Switching:
 *   Set NEXYFAB_SIM_BACKEND=docker in the environment to enable. When unset
 *   or set to anything else, the mock adapters from `simulationAdapters.ts`
 *   are used.
 *
 * Container URLs come from environment variables:
 *   NEXYFAB_SIM_URL_CFD       (default http://localhost:8101)
 *   NEXYFAB_SIM_URL_MBD       (default http://localhost:8102)
 *   NEXYFAB_SIM_URL_CAM       (default http://localhost:8103)
 *   NEXYFAB_SIM_URL_MOLD_FILL (default http://localhost:8104)
 *   NEXYFAB_SIM_URL_OPTICS    (default http://localhost:8105)
 *   NEXYFAB_SIM_URL_THERMAL   (default http://localhost:8106)
 *
 * See `docker-solvers/README.md` for build + deploy instructions.
 */

import { registerSolver, type SolverAdapter } from './simulationQueue';

const DEFAULT_PORTS: Record<string, number> = {
  cfd: 8101, mbd: 8102, cam: 8103, mold_fill: 8104, optics: 8105, thermal: 8106,
};

const ENV_KEY_BY_KIND: Record<string, string> = {
  cfd: 'NEXYFAB_SIM_URL_CFD',
  mbd: 'NEXYFAB_SIM_URL_MBD',
  cam: 'NEXYFAB_SIM_URL_CAM',
  mold_fill: 'NEXYFAB_SIM_URL_MOLD_FILL',
  optics: 'NEXYFAB_SIM_URL_OPTICS',
  thermal: 'NEXYFAB_SIM_URL_THERMAL',
};

function urlFor(kind: string): string {
  const env = process.env[ENV_KEY_BY_KIND[kind] ?? ''];
  if (env && /^https?:\/\//.test(env)) return env.replace(/\/$/, '');
  return `http://localhost:${DEFAULT_PORTS[kind] ?? 8100}`;
}

interface DockerJobStatus<TOut> {
  jobId: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  progress?: number;
  result?: TOut;
  error?: string;
}

const POLL_INTERVAL_MS = 250;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;  // 5 min hard cap per solve

function dockerAdapter<TIn, TOut>(kind: string): SolverAdapter<TIn, TOut> {
  return {
    name: `${kind}-docker`,
    isMock: false,
    async solve(input, onProgress) {
      const base = urlFor(kind);
      // 1) enqueue
      const resp = await fetch(`${base}/solve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input }),
      });
      if (!resp.ok) {
        throw new Error(`docker ${kind} /solve returned HTTP ${resp.status}: ${await resp.text().catch(() => '')}`);
      }
      const queued = await resp.json() as { jobId?: string };
      if (!queued.jobId) throw new Error(`docker ${kind} /solve missing jobId in response`);

      // 2) poll until done|failed|timeout
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      let status: DockerJobStatus<TOut> | null = null;
      while (Date.now() < deadline) {
        const sr = await fetch(`${base}/jobs/${encodeURIComponent(queued.jobId)}`);
        if (!sr.ok) {
          throw new Error(`docker ${kind} poll returned HTTP ${sr.status}`);
        }
        status = await sr.json() as DockerJobStatus<TOut>;
        if (typeof status.progress === 'number') onProgress?.(status.progress);
        if (status.status === 'done') {
          if (status.result === undefined) throw new Error(`docker ${kind} done but no result`);
          return status.result;
        }
        if (status.status === 'failed') {
          throw new Error(status.error ?? `docker ${kind} solver reported failure`);
        }
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      }
      throw new Error(`docker ${kind} solve timed out after ${POLL_TIMEOUT_MS}ms`);
    },
  };
}

let booted = false;

/**
 * Register Docker-backed adapters for all 6 Σ kinds. Call this from the
 * server bootstrap (e.g. middleware or a top-level route file) when
 * `process.env.NEXYFAB_SIM_BACKEND === 'docker'`. Calling twice is safe.
 */
export function bootstrapDockerSolvers(): void {
  if (booted) return;
  for (const kind of Object.keys(DEFAULT_PORTS)) {
    registerSolver(kind, dockerAdapter(kind));
  }
  booted = true;
}

/** Test-only — clear the boot guard. */
export function _resetDockerSolversBoot(): void {
  booted = false;
}

/**
 * Convenience: pick the right adapter set based on NEXYFAB_SIM_BACKEND.
 * Use from the API route so deployments switch by env, not code change.
 */
export async function bootstrapSolversForEnv(): Promise<void> {
  if (process.env.NEXYFAB_SIM_BACKEND === 'docker') {
    bootstrapDockerSolvers();
  } else {
    const { bootstrapMockSolvers } = await import('./simulationAdapters');
    bootstrapMockSolvers();
  }
}
