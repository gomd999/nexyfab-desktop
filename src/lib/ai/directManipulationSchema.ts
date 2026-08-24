import { z } from 'zod';
import type { DirectManipulationIntent } from './directManipulation';

const finite = z.number().finite();
const vector3 = z.tuple([finite, finite, finite]);
const nonEmpty = z.string().trim().min(1).max(512);

const topologyRef = z.object({
  kind: z.enum(['face', 'edge', 'vertex']),
  persistentRef: nonEmpty,
  referenceQuality: z.enum(['persistent', 'derived', 'ambiguous', 'broken']),
  semanticRole: z.string().trim().max(256).optional(),
  geometrySignature: z.string().trim().min(1).max(4096),
});

const selection = z.object({
  version: z.literal(1),
  projectRevision: nonEmpty,
  assemblyPath: z.array(nonEmpty).max(128),
  partInstanceId: nonEmpty.optional(),
  bodyId: nonEmpty.optional(),
  featureId: nonEmpty.optional(),
  topology: z.array(topologyRef).max(512),
  sketchEntityIds: z.array(nonEmpty).max(2048),
  mateIds: z.array(nonEmpty).max(512),
  coordinateFrame: nonEmpty,
  units: z.literal('mm'),
});

const binding = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('feature_parameter'),
    partId: nonEmpty,
    featureId: nonEmpty,
    parameter: nonEmpty,
    unit: z.enum(['mm', 'deg', '1']),
  }),
  z.object({
    kind: z.literal('sketch_dimension'),
    partId: nonEmpty,
    sketchId: nonEmpty,
    entityIds: z.array(nonEmpty).min(1).max(2048),
    unit: z.enum(['mm', 'deg']),
  }),
  z.object({ kind: z.literal('face_offset'), partId: nonEmpty, faceRefs: z.array(nonEmpty).min(1).max(512) }),
  z.object({ kind: z.literal('face_draft'), partId: nonEmpty, faceRefs: z.array(nonEmpty).min(1).max(512), pullDirection: vector3 }),
  z.object({ kind: z.literal('edge_fillet'), partId: nonEmpty, edgeRefs: z.array(nonEmpty).min(1).max(512) }),
  z.object({ kind: z.literal('edge_chamfer'), partId: nonEmpty, edgeRefs: z.array(nonEmpty).min(1).max(512) }),
  z.object({ kind: z.literal('occurrence_translate'), partId: nonEmpty, axis: vector3 }),
  z.object({ kind: z.literal('occurrence_rotate'), partId: nonEmpty, axis: vector3 }),
]);

export const directManipulationIntentSchema: z.ZodType<DirectManipulationIntent> = z.object({
  schema: z.literal('nexyfab.direct-manipulation-intent.v1'),
  version: z.literal(1),
  intentId: nonEmpty,
  gestureId: nonEmpty,
  sessionId: nonEmpty,
  sequence: z.number().int().nonnegative(),
  idempotencyKey: nonEmpty,
  phase: z.enum(['preview', 'commit']),
  createdAt: z.string().datetime({ offset: true }),
  projectId: nonEmpty,
  baseRevision: nonEmpty,
  coordinateFrame: nonEmpty,
  viewportRevision: nonEmpty,
  device: z.object({
    platform: z.enum(['desktop', 'mobile']),
    pointer: z.enum(['mouse', 'pen', 'touch', 'keyboard', 'numeric']),
    pointerCount: z.number().int().min(0).max(16),
  }).passthrough(),
  origin: z.enum(['user_gauge', 'ai_suggestion']),
  sourceModelReceipt: z.object({
    receiptId: nonEmpty,
    schema: z.literal('nexyfab.model-selection-receipt.v1'),
    selectedModelId: nonEmpty,
    policy: z.object({
      conceptOnly: z.literal(true),
      copyrightSafe: z.literal(true),
      exactGeometryAuthority: z.literal(false),
    }).passthrough(),
  }).passthrough().optional(),
  userCommand: z.string().trim().min(1).max(4096),
  selection,
  binding,
  measurement: z.object({
    semantics: z.enum(['absolute', 'delta']),
    startValue: finite,
    targetValue: finite,
    delta: finite,
    unit: z.enum(['mm', 'deg', '1']),
    snapIncrement: finite.positive().optional(),
  }),
  rollback: z.object({
    snapshotId: nonEmpty,
    snapshotDigestSha256: z.string().regex(/^[a-f0-9]{64}$/),
    baseRevision: nonEmpty,
  }).passthrough().optional(),
  confirmation: z.object({
    confirmed: z.literal(true),
    proposalId: nonEmpty,
    baseRevision: nonEmpty,
    confirmedAt: z.string().datetime({ offset: true }),
  }).passthrough().optional(),
  assumptions: z.array(z.string().trim().min(1).max(1024)).max(64).optional(),
  unresolved: z.array(z.string().trim().min(1).max(1024)).max(64).optional(),
}).passthrough();

export const directManipulationRequestSchema = z.object({
  requestId: nonEmpty,
  createdAt: z.string().datetime({ offset: true }),
  intentDigestSha256: z.string().regex(/^[a-f0-9]{64}$/),
  currentRevision: nonEmpty,
  intent: directManipulationIntentSchema,
}).passthrough();

export type DirectManipulationRequest = z.infer<typeof directManipulationRequestSchema>;
