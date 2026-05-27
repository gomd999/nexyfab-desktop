/**
 * /health — Railway healthcheck endpoint.
 *
 * Returns 200 with worker status + OCCT readiness so Railway's
 * liveness probe sees the service alive once OCCT finishes its
 * 5 MB WASM load. Until then, status is 'starting' (still 200 so
 * Railway doesn't restart-loop).
 */

import { Router, type Request, type Response } from 'express';
import { getOcctStatus } from '../occt/lifecycle.js';

export const healthRoute: Router = Router();

healthRoute.get('/', (_req: Request, res: Response) => {
  const occt = getOcctStatus();
  res.status(200).json({
    service: 'nexyfab-occt-worker',
    version: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 8) ?? 'dev',
    occt: occt.ready ? 'ready' : occt.error ? 'error' : 'starting',
    occtError: occt.error ?? undefined,
    uptimeSec: Math.round(process.uptime()),
  });
});
