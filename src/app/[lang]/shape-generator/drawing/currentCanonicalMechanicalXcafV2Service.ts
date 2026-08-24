import { createHash } from 'node:crypto';
import type { DbAdapter } from '@/lib/db-adapter';
import {
  buildCurrentCanonicalMechanicalArtifactBundleV2,
  validateCurrentCanonicalMechanicalArtifactBundleV2,
  type CurrentCanonicalMechanicalArtifactBundleV2,
} from './currentCanonicalMechanicalBundleV2';
import {
  buildCurrentCanonicalXcafOccurrenceV2,
  type CurrentCanonicalXcafOccurrenceEnvelope,
} from '@/lib/occt/currentCanonicalXcafOccurrence';
import type { XcafInspectionResult } from '@/lib/occt/xcafCanonicalBinding';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const STEP_HEADER = 'ISO-10303-21;';

export interface XcafV2Inspector {
  inspect(input: { inputBytes: Uint8Array; sha256: string }): Promise<XcafInspectionResult>;
}

export type CurrentCanonicalMechanicalXcafV2Result =
  | CurrentCanonicalXcafOccurrenceEnvelope
  | {
      schema: 'nexyfab.precision-cad.current-head-xcaf-occurrence-envelope.v1';
      status: 'HOLD';
      release: 'HOLD';
      blockers: readonly ['CURRENT_XCAF_V2_SERVICE_HOLD'];
    };

function hold(): CurrentCanonicalMechanicalXcafV2Result {
  return {
    schema: 'nexyfab.precision-cad.current-head-xcaf-occurrence-envelope.v1',
    status: 'HOLD',
    release: 'HOLD',
    blockers: ['CURRENT_XCAF_V2_SERVICE_HOLD'],
  };
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function validatedInput(input: unknown): {
  db: DbAdapter;
  projectId: string;
  documentId: string;
  inspector: XcafV2Inspector;
} | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const ownKeys = Reflect.ownKeys(input);
  const expected = ['db', 'documentId', 'inspector', 'projectId'];
  if (ownKeys.some(key => typeof key !== 'string')
    || (ownKeys as string[]).sort().join('|') !== expected.sort().join('|')) return null;
  const values: Record<string, unknown> = {};
  for (const key of ownKeys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) return null;
    values[key] = descriptor.value;
  }
  if (!values.db || typeof values.projectId !== 'string' || !SAFE_ID.test(values.projectId)
    || typeof values.documentId !== 'string' || !SAFE_ID.test(values.documentId)
    || !values.inspector || typeof values.inspector !== 'object') return null;
  const inspectDescriptor = Object.getOwnPropertyDescriptor(values.inspector, 'inspect');
  if (!inspectDescriptor || !('value' in inspectDescriptor) || typeof inspectDescriptor.value !== 'function') return null;
  const inspect = inspectDescriptor.value.bind(values.inspector) as XcafV2Inspector['inspect'];
  return {
    db: values.db as DbAdapter,
    projectId: values.projectId,
    documentId: values.documentId,
    inspector: Object.freeze({ inspect }),
  };
}

/**
 * Server-only v2 orchestration. The STEP bytes are generated from the current
 * canonical v2 head and immediately inspected; callers cannot inject bundle,
 * revision, STEP, worker receipt, URL, or credentials.
 */
export async function readCurrentCanonicalMechanicalXcafV2(
  input: unknown,
): Promise<CurrentCanonicalMechanicalXcafV2Result> {
  try {
    const validated = validatedInput(input);
    if (!validated) return hold();
    const { db, projectId, documentId, inspector } = validated;
    const generated = await buildCurrentCanonicalMechanicalArtifactBundleV2({
      db, projectId, documentId,
    });
    if (generated.status !== 'EXACT_BUNDLE_V2_PASS') return hold();
    const checked = await validateCurrentCanonicalMechanicalArtifactBundleV2(generated);
    if (!checked.ok) return hold();
    const bundle: CurrentCanonicalMechanicalArtifactBundleV2 = checked.bundle;
    const exact = bundle.handoff.exactSinglePart;
    const text = exact?.step.text;
    if (!exact || typeof text !== 'string' || !text.startsWith(STEP_HEADER)) return hold();
    const bytes = new TextEncoder().encode(text);
    const digest = sha256(bytes);
    if (digest !== bundle.artifacts.stepSha256 || digest !== exact.step.sha256) return hold();
    const inspection = await inspector.inspect({ inputBytes: bytes, sha256: digest });
    const envelope = buildCurrentCanonicalXcafOccurrenceV2({ bundle, inspection });
    return envelope.status === 'PASS_NATIVE_INVOCATION_BOUND' ? envelope : hold();
  } catch {
    return hold();
  }
}
