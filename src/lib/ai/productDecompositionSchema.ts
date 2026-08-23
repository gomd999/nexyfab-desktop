import { z } from 'zod';
import { validateFeatureTreeValue } from '@/lib/cad/featureTreeValidation';
import type { ProductDecompositionPlan, ProductDecompositionIssue } from './productDecomposition';
import { physicalNetworkModelSchema } from './mepConnectionSchema';

const id = z.string().trim().min(1).max(128);
const text = z.string().trim().min(1).max(4_000);
const finite = z.number().finite().min(-1_000_000_000).max(1_000_000_000);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/i);
const featureKind = z.enum(['extrude', 'revolve', 'sweep', 'loft', 'linear_pattern', 'circular_pattern', 'hole', 'fillet', 'chamfer', 'shell', 'rib', 'sweep_path', 'boolean']);

const jsonPayload = z.object({ kind: featureKind }).passthrough().superRefine((value, ctx) => {
  const visit = (item: unknown, path: Array<string | number>, depth: number): void => {
    if (depth > 32) { ctx.addIssue({ code: 'custom', path, message: 'payload nesting exceeds 32 levels' }); return; }
    if (typeof item === 'number' && (!Number.isFinite(item) || Math.abs(item) > 1_000_000_000)) ctx.addIssue({ code: 'custom', path, message: 'numeric payload must be finite and bounded' });
    if (typeof item === 'string' && item.length > 100_000) ctx.addIssue({ code: 'custom', path, message: 'payload string is too long' });
    if (Array.isArray(item)) {
      if (item.length > 10_000) ctx.addIssue({ code: 'custom', path, message: 'payload array is too large' });
      item.forEach((child, index) => visit(child, [...path, index], depth + 1));
    } else if (item && typeof item === 'object') {
      const entries = Object.entries(item as Record<string, unknown>);
      if (entries.length > 1_000) ctx.addIssue({ code: 'custom', path, message: 'payload object has too many fields' });
      for (const [key, child] of entries) {
        if (['__proto__', 'prototype', 'constructor'].includes(key)) ctx.addIssue({ code: 'custom', path: [...path, key], message: 'unsafe payload key' });
        visit(child, [...path, key], depth + 1);
      }
    }
  };
  visit(value, [], 0);
});

const featureTree = z.object({
  nodes: z.array(z.object({
    id,
    name: z.string().max(256),
    suppressed: z.boolean().optional(),
    dependencies: z.array(id).max(500),
    payload: jsonPayload,
  }).strict()).max(500),
}).strict().superRefine((value, ctx) => {
  const result = validateFeatureTreeValue(value);
  if (!result.ok) ctx.addIssue({ code: 'custom', message: result.message });
});

const parameterEvidence = z.object({
  path: z.string().trim().min(1).max(512),
  value: finite,
  unit: z.enum(['mm', 'deg', 'ratio', 'count']),
  tolerance: z.number().finite().nonnegative().max(1_000_000).optional(),
  status: z.enum(['confirmed', 'derived', 'catalog']),
  sourceRef: id,
  derivation: z.string().trim().min(1).max(2_000).optional(),
  inputSourceRefs: z.array(id).max(50).optional(),
  locked: z.boolean(),
}).strict();

const mateRef = z.object({ partId: id, refId: id, refKind: z.enum(['face', 'edge', 'axis', 'plane', 'point']) }).strict();
const vec3 = z.object({ x: finite, y: finite, z: finite }).strict();
const mate = z.object({
  id,
  kind: z.enum(['coincident', 'concentric', 'distance', 'angle', 'parallel', 'perpendicular', 'tangent', 'hinge', 'slot', 'gear', 'rack_pinion']),
  a: mateRef,
  b: mateRef,
  suppressed: z.boolean().optional(),
  value: finite.optional(),
  ratio: z.number().finite().positive().optional(),
  reverse: z.boolean().optional(),
  backlash: z.number().finite().nonnegative().optional(),
  slotLength: z.number().finite().positive().optional(),
  pinionRadius: z.number().finite().positive().optional(),
  limit: z.object({ minAngleDeg: finite, maxAngleDeg: finite }).strict().optional(),
  rackTravel: z.object({ min: finite, max: finite }).strict().optional(),
  zeroAngleRef: z.object({
    a: vec3, b: vec3, axisA: vec3, axisB: vec3,
  }).strict().optional(),
}).passthrough();

export const productDecompositionPlanSchema = z.object({
  version: z.literal(1),
  units: z.literal('mm'),
  productName: z.string().trim().min(1).max(256),
  requirements: z.array(z.object({
    id, text, category: z.enum(['function', 'interface', 'load', 'motion', 'material', 'process', 'safety']),
    source: z.enum(['user', 'manual', 'derived']), sourceRef: id, acceptance: z.string().trim().min(1).max(2_000).optional(),
  }).strict()).min(1).max(500),
  definitions: z.array(z.object({
    id, name: z.string().trim().min(1).max(256), responsibility: text, makeOrBuy: z.enum(['make', 'buy']),
    featureTree,
    metadata: z.object({
      partNumber: id, revision: z.string().trim().min(1).max(64), material: z.string().trim().min(1).max(256).optional(),
      process: z.string().trim().min(1).max(256).optional(), source: z.enum(['confirmed', 'assumed', 'catalog']),
      catalogId: id.optional(), catalogRevision: id.optional(), artifactSha256: sha256.optional(),
    }).strict(),
    requirementIds: z.array(id).min(1).max(500),
    parameterEvidence: z.array(parameterEvidence).max(20_000),
  }).strict()).min(1).max(500),
  instances: z.array(z.object({
    id, definitionId: id, name: z.string().max(256).optional(), positionMm: z.tuple([finite, finite, finite]),
    orientation: z.object({ x: finite, y: finite, z: finite, w: finite }).strict().optional(), fixed: z.boolean().optional(),
  }).strict()).min(1).max(10_000),
  mates: z.array(mate).max(20_000),
  subassemblies: z.array(z.object({ id, name: z.string().trim().min(1).max(256), instanceIds: z.array(id).max(10_000), rigid: z.boolean(), parentId: id.optional() }).strict()).max(1_000),
  physicalNetworks: z.array(physicalNetworkModelSchema).max(100).optional(),
  observations: z.array(z.string().max(4_000)).max(1_000),
  assumptions: z.array(z.string().max(4_000)).max(1_000),
  unresolved: z.array(z.string().max(4_000)).max(1_000),
}).strict();

export function parseProductDecompositionPlan(value: unknown):
  | { ok: true; plan: ProductDecompositionPlan }
  | { ok: false; issues: ProductDecompositionIssue[] } {
  const parsed = productDecompositionPlanSchema.safeParse(value);
  if (parsed.success) return { ok: true, plan: parsed.data as unknown as ProductDecompositionPlan };
  return { ok: false, issues: parsed.error.issues.map(issue => ({ path: issue.path.join('.') || '$', message: issue.message })) };
}
