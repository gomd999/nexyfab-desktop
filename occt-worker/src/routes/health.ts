/**
 * /health — Railway healthcheck endpoint.
 *
 * Returns 200 with worker status + OCCT readiness so Railway's
 * liveness probe sees the service alive once OCCT finishes its
 * 5 MB WASM load. Until then, status is 'starting' (still 200 so
 * Railway doesn't restart-loop).
 */

import { Router, type Request, type Response } from 'express';
import { getPool } from '../pool/workerPool.js';

export const healthRoute: Router = Router();

healthRoute.get('/', (_req: Request, res: Response) => {
  const pool = getPool().status();
  // Pool ready means at least one worker thread loaded OCCT. We stay
  // 200 even at 0/N so Railway doesn't restart-loop during the WASM
  // load (~5 s per slot).
  const occt = pool.readyCount > 0
    ? 'ready'
    : pool.readyCount === 0 && pool.size > 0
      ? 'starting'
      : 'error';
  res.status(200).json({
    service: 'nexyfab-occt-worker',
    version: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 8) ?? 'dev',
    occt,
    pool: {
      size: pool.size,
      ready: pool.readyCount,
      busy: pool.busyCount,
      queueDepth: pool.queueDepth,
      queueCapacity: pool.queueCapacity,
      opsCompleted: pool.totalOpsCompleted,
    },
    uptimeSec: Math.round(process.uptime()),
  });
});
