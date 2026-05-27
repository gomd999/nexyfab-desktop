/**
 * NexyFab OCCT worker — entry point.
 *
 * ADR-007 (Wave 1 W9-12) — separate Railway service hosting heavy
 * OCCT B-rep operations. Reduces main app's tab freezing on 1000+
 * part assemblies; routes large geometry through R2 to avoid HTTP
 * body-size limits.
 *
 * W9 D3-4 scope (this file): Express server skeleton + /health + Sentry
 * boot + R2 client init. No actual OCCT operations yet — those land
 * in W10 D1-3 with `POST /occt/op/boolean`.
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import { initSentry } from './sentry.js';
import { healthRoute } from './routes/health.js';
import { occtRoute } from './routes/occt.js';
import { authMiddleware } from './middleware/auth.js';
import { requestId } from './middleware/requestId.js';

const PORT = parseInt(process.env.PORT ?? '8080', 10);
const NODE_ENV = process.env.NODE_ENV ?? 'production';

// Boot Sentry before anything else — captures errors that happen
// during module load (e.g. missing R2 env vars).
initSentry();

const app = express();

// Body limit kept low (256 KB) — geometry payload goes through R2,
// not the request body. Param objects + handle ids fit easily.
app.use(express.json({ limit: '256kb' }));
app.use(requestId);

// /health stays unauthenticated so the Railway healthcheck + uptime
// monitoring don't need to know JWT secrets. Auth gate applies to
// /occt/* only.
app.use('/health', healthRoute);

// Wave 1 W9 D5 — placeholder mount; W10 D1-3 fills in
// POST /occt/op/boolean etc.
app.use('/occt', authMiddleware, occtRoute);

// 404 fallback.
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'not found', path: req.path });
});

// Error fallback — Sentry catches via console capture; this keeps the
// HTTP contract clean (always JSON).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  console.error('[occt-worker] unhandled error:', err);
  res.status(500).json({
    error: 'internal error',
    requestId: (req as Request & { requestId?: string }).requestId,
  });
});

const server = app.listen(PORT, () => {
  console.log(`[occt-worker] listening on :${PORT} (NODE_ENV=${NODE_ENV})`);
});

// Graceful shutdown — Railway sends SIGTERM with ~10 s grace period.
// Stop accepting new connections, then exit when in-flight requests
// drain. Hard exit after 8 s in case OCCT WASM holds a thread.
function shutdown(signal: string): void {
  console.log(`[occt-worker] ${signal} received, draining…`);
  server.close(() => {
    console.log('[occt-worker] drain complete, exit 0');
    process.exit(0);
  });
  setTimeout(() => {
    console.warn('[occt-worker] drain timed out, forcing exit');
    process.exit(1);
  }, 8000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
