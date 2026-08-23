import { NextRequest, NextResponse } from 'next/server';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import { z } from 'zod';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimit } from '@/lib/rate-limit';
import {
  BIM_REGISTRY_SCHEMA,
  validateBimInformationInstance,
  validateBimInformationRegistry,
  type BimInformationInstance,
  type BimInformationRegistry,
} from '@/lib/bim/informationRegistry';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const stage = z.enum(['common', 'design', 'construction', 'maintenance']);
const valueType = z.enum(['string', 'number', 'integer', 'boolean', 'date', 'object', 'array']);
const sourceReference = z.object({
  id: z.string().trim().min(1).max(300), path: z.string().trim().min(1).max(2_000), revision: z.string().trim().min(1).max(200),
  sheet: z.string().trim().min(1).max(300).optional(), access: z.literal('read_only'),
}).strict();
const unit = z.object({
  code: z.string().trim().min(1).max(200), symbol: z.string().max(100),
  dimension: z.enum(['none', 'length', 'area', 'volume', 'mass', 'count', 'time', 'ratio', 'custom']),
}).strict();
const classification = z.object({
  scheme: z.enum(['WBS', 'OBS']), code: z.string().trim().min(1).max(200), name: z.string().trim().min(1).max(1_000),
  level: z.number().int().min(1).max(7), parentCode: z.string().trim().min(1).max(200).optional(), sourceRef: z.string().trim().min(1).max(300),
}).strict();
const formula = z.object({
  expression: z.string().trim().min(1).max(2_000), variables: z.array(z.string().trim().min(1).max(200)).max(500),
  tolerance: z.number().finite().nonnegative().max(1e12).optional(),
}).strict();
const propertyDefinition = z.object({
  pset: z.string().trim().min(1).max(300), key: z.string().trim().min(1).max(200), name: z.string().trim().min(1).max(1_000),
  type: z.enum(['string', 'number', 'integer', 'boolean', 'date']), unit: z.string().trim().min(1).max(200),
  requiredAt: z.array(stage).max(4), formula: formula.optional(), description: z.string().max(10_000).optional(),
  sourceRef: z.string().trim().min(1).max(300),
}).strict();
const bepRequirement = z.object({
  key: z.string().trim().min(1).max(200), type: valueType, requiredAt: z.array(stage).max(4), sourceRef: z.string().trim().min(1).max(300),
}).strict();
const registry = z.object({
  schema: z.literal(BIM_REGISTRY_SCHEMA), registryId: z.string().trim().min(1).max(300), version: z.string().trim().min(1).max(200),
  sourceReferences: z.array(sourceReference).max(20_000), units: z.array(unit).max(10_000),
  classifications: z.array(classification).max(200_000), properties: z.array(propertyDefinition).max(100_000),
  bepRequirements: z.array(bepRequirement).max(10_000),
}).strict();
const propertyValue = z.object({
  pset: z.string().trim().min(1).max(300), key: z.string().trim().min(1).max(200), value: z.unknown(),
  unit: z.string().trim().min(1).max(200), source: z.enum(['user', 'ai', 'imported', 'derived']), sourceRef: z.string().trim().min(1).max(2_000),
}).strict();
const instance = z.object({
  registryId: z.string().trim().min(1).max(300), registryVersion: z.string().trim().min(1).max(200), stage,
  classifications: z.array(z.object({ scheme: z.enum(['WBS', 'OBS']), code: z.string().trim().min(1).max(200) }).strict()).max(100_000),
  properties: z.array(propertyValue).max(100_000), bep: z.record(z.string().trim().min(1).max(200), z.unknown()),
}).strict();
const requestSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('registry'), registry }).strict(),
  z.object({ mode: z.literal('instance'), registry, instance }).strict(),
]);

export async function POST(req: NextRequest): Promise<NextResponse> {
  const contentLength = Number(req.headers.get('content-length') ?? 0);
  if (contentLength > 10_000_000) {
    await req.body?.cancel('declared payload too large').catch(() => undefined);
    return NextResponse.json({ ok: false, error: 'payload_too_large' }, { status: 413 });
  }
  const limit = rateLimit(`bim-information-validate:${getTrustedClientIp(req.headers)}`, 30, 60_000);
  if (!limit.allowed) return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 });
  let body: unknown;
  try { body = await readBoundedJson(req, 10_000_000); }
  catch (error) {
    if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ ok: false, error: 'payload_too_large' }, { status: 413 });
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'invalid_request', issues: parsed.error.issues.map(value => ({ path: value.path.join('.'), message: value.message })) }, { status: 400 });
  const report = parsed.data.mode === 'registry'
    ? validateBimInformationRegistry(parsed.data.registry as BimInformationRegistry)
    : validateBimInformationInstance(parsed.data.registry as BimInformationRegistry, parsed.data.instance as BimInformationInstance);
  return NextResponse.json({ ok: report.status === 'valid', ...report }, { status: report.status === 'valid' ? 200 : 422 });
}
