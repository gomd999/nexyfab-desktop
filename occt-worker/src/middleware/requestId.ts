/**
 * Request-id middleware — assigns a UUID to every incoming request so
 * Sentry events + log lines + the response body all reference the same
 * id. The main app can pass `x-request-id` to make this a single
 * across-service correlation token; otherwise we generate.
 */

import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';

export interface RequestWithId extends Request {
  requestId: string;
}

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const headerVal = req.header('x-request-id');
  const id = (typeof headerVal === 'string' && headerVal.length > 0 && headerVal.length < 80)
    ? headerVal
    : randomUUID();
  (req as RequestWithId).requestId = id;
  res.setHeader('x-request-id', id);
  next();
}
