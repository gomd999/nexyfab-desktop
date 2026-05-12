/**
 * Optional RFQ attachment: client-side CAE hints (FEA/modal/thermal).
 * Never server-verified physics — stored for communication / matching context only.
 */
import { z } from 'zod';

/** UTF-8 byte cap for serialized JSON (DoS-safe column size). */
export const RFQ_ANALYSIS_SUMMARY_MAX_BYTES = 4096;

const stressBlock = z
  .object({
    maxMpa: z.number().finite().min(0).max(1e7),
    yieldMpa: z.number().finite().min(0).max(1e7).optional(),
    pass: z.boolean().optional(),
  })
  .strict();

const modalBlock = z
  .object({
    firstHz: z.number().finite().min(0).max(1e12),
  })
  .strict();

const thermalBlock = z
  .object({
    maxC: z.number().finite().min(-273).max(10_000),
  })
  .strict();

/** Body schema — no provenance field; server stamps it after validation. */
export const rfqAnalysisSummaryBodySchema = z
  .object({
    v: z.literal(1),
    feaLinear: stressBlock.optional(),
    modal: modalBlock.optional(),
    thermal: thermalBlock.optional(),
    source: z.enum(['shape-generator', 'upload', 'unknown']).optional(),
    inputsHash: z
      .string()
      .max(120)
      .regex(/^[a-zA-Z0-9:_+=.\-]+$/)
      .optional(),
  })
  .strict();

/** Full persisted shape (includes server-stamped provenance). */
export const rfqAnalysisSummaryStoredSchema = rfqAnalysisSummaryBodySchema.and(
  z.object({ provenance: z.literal('client_self_report') }).strict(),
);

export type RfqAnalysisSummaryStored = z.infer<typeof rfqAnalysisSummaryStoredSchema>;

function utf8ByteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/**
 * Validates shape + size; stamps `provenance: client_self_report`.
 * Returns null if input is undefined/null or validation fails.
 */
export function serializeRfqAnalysisSummary(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  const parsed = rfqAnalysisSummaryBodySchema.safeParse(raw);
  if (!parsed.success) return null;
  const out = {
    ...parsed.data,
    provenance: 'client_self_report' as const,
  };
  const stamped = rfqAnalysisSummaryStoredSchema.safeParse(out);
  if (!stamped.success) return null;
  const json = JSON.stringify(stamped.data);
  if (utf8ByteLength(json) > RFQ_ANALYSIS_SUMMARY_MAX_BYTES) return null;
  return json;
}

/** Parse DB column (strict schema; malformed legacy rows yield undefined). */
export function parseStoredAnalysisSummary(
  raw: string | null | undefined,
): RfqAnalysisSummaryStored | undefined {
  if (raw == null || raw === '') return undefined;
  try {
    const o = JSON.parse(raw) as unknown;
    const again = rfqAnalysisSummaryStoredSchema.safeParse(o);
    if (!again.success) return undefined;
    return again.data;
  } catch {
    return undefined;
  }
}
