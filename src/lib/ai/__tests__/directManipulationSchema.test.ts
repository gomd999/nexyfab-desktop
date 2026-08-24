import { describe, expect, it } from 'vitest';
import { DIRECT_MANIPULATION_INTENT_SCHEMA } from '../directManipulation';
import { directManipulationRequestSchema } from '../directManipulationSchema';

const validRequest = () => ({
  requestId: 'request-1',
  createdAt: '2026-08-24T00:00:00.000Z',
  intentDigestSha256: 'a'.repeat(64),
  currentRevision: 'rev-1',
  intent: {
    schema: DIRECT_MANIPULATION_INTENT_SCHEMA,
    version: 1,
    intentId: 'intent-1',
    gestureId: 'gesture-1',
    sessionId: 'session-1',
    sequence: 1,
    idempotencyKey: 'key-1',
    phase: 'preview',
    createdAt: '2026-08-24T00:00:00.000Z',
    projectId: 'project-1',
    baseRevision: 'rev-1',
    coordinateFrame: 'world',
    viewportRevision: 'viewport-1',
    device: { platform: 'mobile', pointer: 'touch', pointerCount: 1 },
    origin: 'user_gauge',
    userCommand: 'move part',
    selection: {
      version: 1,
      projectRevision: 'rev-1',
      assemblyPath: ['main'],
      partInstanceId: 'part-1',
      topology: [],
      sketchEntityIds: [],
      mateIds: [],
      coordinateFrame: 'world',
      units: 'mm',
    },
    binding: { kind: 'occurrence_translate', partId: 'part-1', axis: [1, 0, 0] },
    measurement: { semantics: 'delta', startValue: 0, targetValue: 5, delta: 5, unit: 'mm' },
  },
});

describe('direct manipulation wire schema', () => {
  it('accepts a bounded, finite contract request', () => {
    expect(directManipulationRequestSchema.safeParse(validRequest()).success).toBe(true);
  });

  it('rejects non-finite values before planning', () => {
    const request = validRequest();
    request.intent.measurement.targetValue = Number.POSITIVE_INFINITY;
    expect(directManipulationRequestSchema.safeParse(request).success).toBe(false);
  });

  it('rejects oversized untrusted arrays', () => {
    const request = validRequest();
    request.intent.selection.assemblyPath = Array.from({ length: 129 }, (_, index) => `part-${index}`);
    expect(directManipulationRequestSchema.safeParse(request).success).toBe(false);
  });

  it('preserves additive top-level fields for forward compatibility', () => {
    const request = { ...validRequest(), extensionField: 'keep-me' };
    const parsed = directManipulationRequestSchema.parse(request);
    expect((parsed as Record<string, unknown>).extensionField).toBe('keep-me');
  });
});
