/**
 * M2: `feature_pipeline` telemetry context is nested under `context`.
 * `logAudit` only persists string/number/boolean at metadata top-level (see audit.ts),
 * so we flatten selected keys for DB + Sentry tags.
 */

export interface FlattenedFeaturePipelineFields {
  diagnosticCode?: string;
  featureId?: string;
  featureType?: string;
  /** e.g. `occt_init`, `shape_generator_worker` — for ops dashboards */
  stage?: string;
  enabledFeatureCount?: number;
}

export function flattenFeaturePipelineContext(
  ctx: Record<string, unknown> | undefined | null,
): FlattenedFeaturePipelineFields {
  if (!ctx || typeof ctx !== 'object') return {};
  const out: FlattenedFeaturePipelineFields = {};
  const dc = ctx.diagnosticCode;
  if (typeof dc === 'string' && dc.length > 0) out.diagnosticCode = dc.trim().slice(0, 64);
  const fid = ctx.featureId;
  if (typeof fid === 'string' && fid.length > 0) out.featureId = fid.trim().slice(0, 128);
  const ft = ctx.featureType;
  if (typeof ft === 'string' && ft.length > 0) out.featureType = ft.trim().slice(0, 64);
  const st = ctx.stage;
  if (typeof st === 'string' && st.length > 0) out.stage = st.trim().slice(0, 64);
  const efc = ctx.enabledFeatureCount;
  if (typeof efc === 'number' && Number.isFinite(efc)) out.enabledFeatureCount = Math.max(0, Math.floor(efc));
  return out;
}
