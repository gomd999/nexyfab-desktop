/**
 * Pro+ users receive stable `cad.*` audit rows for mesh/drawing/CAM info events.
 * Skipping the parallel `telemetry.{source}.info` row avoids duplicate DB noise.
 * See `POST /api/nexyfab/telemetry` and optional explicit `POST /api/nexyfab/cad-audit`.
 */

import { meetsPlan } from '@/lib/plan-guard';

export const CAD_EXPORT_TELEMETRY_SOURCES = new Set([
  'drawing_export',
  'mesh_export',
  'cam_toolpath',
]);

export function shouldSkipTelemetryDuplicateForCadAudit(opts: {
  authUser: { plan: string } | null | undefined;
  level?: 'error' | 'warning' | 'info';
  source: string | undefined;
}): boolean {
  const level = opts.level ?? 'error';
  return (
    opts.authUser != null &&
    level === 'info' &&
    CAD_EXPORT_TELEMETRY_SOURCES.has(opts.source ?? '') &&
    meetsPlan(opts.authUser.plan, 'pro')
  );
}
