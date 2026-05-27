/**
 * /occt/op/* — OCCT operation endpoints.
 *
 * W9 D5 stub. W10 D1-3 fills in `POST /occt/op/boolean`. ADR-007 lists
 * the full set: boolean / fillet / chamfer / shell / extrude / revolve /
 * sweep / loft / pattern / mirror.
 *
 * Request shape:
 *   POST /occt/op/{operation}
 *   body: { inputR2Keys: string[], params: object }
 *   response: { outputR2Key: string, stepR2Key: string, stlR2Key: string,
 *               meta: { volume, surface, manifold, bbox } }
 *
 * All payload goes through R2 — request body holds only keys + params.
 */

import { Router, type Request, type Response } from 'express';

export const occtRoute: Router = Router();

// Placeholder until W10 D1-3 implementation.
occtRoute.post('/op/:operation', (req: Request, res: Response) => {
  const operation = req.params.operation;
  const known = new Set([
    'boolean', 'fillet', 'chamfer', 'shell',
    'extrude', 'revolve', 'sweep', 'loft',
    'pattern', 'mirror',
  ]);
  if (!known.has(operation)) {
    res.status(400).json({ error: 'unknown operation', operation });
    return;
  }

  // ADR-007 § "Service shape" — not yet implemented. The endpoint
  // returns 501 so the client's three-tier fallback chain (server →
  // client OCCT → mesh-CSG) drops to client OCCT.
  res.status(501).json({
    error: 'not implemented',
    operation,
    note: 'Wave 1 W10 D1-3 will land this. Client should fall back to in-tab OCCT.',
  });
});
