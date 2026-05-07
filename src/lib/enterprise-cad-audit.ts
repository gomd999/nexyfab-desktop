/**
 * Enterprise CAD pipeline audit — writes to `nf_audit_log` via `logAudit`.
 * Opt-in for Pro+ by default; set `NEXYFAB_CAD_AUDIT_ALL=1` to include Free tier (ops/debug).
 *
 * Ingestion paths: (1) batched client telemetry (`/api/nexyfab/telemetry`) fans out `cad.*`
 * for drawing/mesh/CAM info events; (2) optional direct POST `/api/nexyfab/cad-audit` for
 * explicit audit-only pings without embedding in the telemetry buffer.
 */

import { logAudit } from '@/lib/audit';
import { meetsPlan } from '@/lib/plan-guard';

function shouldAudit(plan: string): boolean {
  if (process.env.NEXYFAB_CAD_AUDIT_ALL === '1') return true;
  return meetsPlan(plan, 'pro');
}

/** Stable action names for filtering in `/api/nexyfab/audit`. */
export const CadAuditAction = {
  STEP_IMPORT_SYNC: 'cad.step_import.sync',
  STEP_IMPORT_ASYNC: 'cad.step_import.async',
  OPENSCAD_SYNC: 'cad.openscad.sync',
  OPENSCAD_ASYNC: 'cad.openscad.async',
  /** Client drawing PDF/DXF/SVG — also emitted via `/api/nexyfab/telemetry` (info). */
  DRAWING_EXPORT: 'cad.drawing.export',
  CAM_TOOLPATH_REQUEST: 'cad.cam.toolpath',
  MESH_EXPORT: 'cad.mesh.export',
} as const;

export function logCadPipelineAudit(opts: {
  userId: string;
  plan: string;
  action: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
}): void {
  if (!shouldAudit(opts.plan)) return;
  logAudit({
    userId: opts.userId,
    action: opts.action,
    resourceId: opts.resourceId,
    metadata: opts.metadata,
    ip: opts.ip,
  });
}
