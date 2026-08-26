import {
  hashCanonicalCadCommandV2,
  validateCanonicalCadCommandV2,
  type CanonicalCadCommandV2ConsumerDraft,
} from './canonicalCadV2ConsumerDraft';
import { FEATURE_REGISTRY_HASH } from './featureRegistry';
import {
  validateNativeMechanicalExactFeatureResult,
  type NativeMechanicalExactFeatureResult,
} from '../occt/nativeMechanicalExactFeatureLoop';

const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_NODES = 20_000;
const MAX_DEPTH = 32;
const MAX_STRING_LENGTH = 8 * 1024 * 1024;
const RESULT_KEYS = ['command', 'result', 'currentRegistryHash'] as const;
const BINDING_KEYS = [
  'schema', 'featureId', 'operationId', 'registryHash', 'runtimeIdentitySha256',
  'requestSha256', 'resultMeasurementSha256', 'roundtripMeasurementSha256',
  'receiptArtifactId', 'receiptSha256', 'stepArtifactId', 'stepSha256',
] as const;
const REQUIRED_VERIFIERS = ['part-exact-brep', 'part-step-roundtrip'] as const;

export const NATIVE_MECHANICAL_EXACT_COMMAND_BINDING_SCHEMA =
  'nexyfab.precision-cad.native-mechanical-exact-command-binding.v1' as const;

type PlainRecord = Record<string, unknown>;

export interface NativeMechanicalExactPrecommitInput {
  command: CanonicalCadCommandV2ConsumerDraft;
  result: NativeMechanicalExactFeatureResult;
  currentRegistryHash: string;
}

export type NativeMechanicalExactPrecommitDecision =
  | { authority: 'PRECISION_LOCAL_STRUCTURAL_GATE'; status: 'EVIDENCE_BOUND'; verification: 'STRUCTURAL_ONLY'; authoritativeCommit: false; release: 'HOLD'; commandId: string; receiptSha256: string; stepSha256: string }
  | { authority: 'PRECISION_LOCAL_STRUCTURAL_GATE'; status: 'HOLD'; verification: 'NOT_RUN'; authoritativeCommit: false; release: 'HOLD'; blockers: readonly string[] };

function isRecord(value: unknown): value is PlainRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function snapshot(value: unknown, seen = new Set<object>(), budget = { nodes: 0 }, depth = 0): unknown {
  if (++budget.nodes > MAX_NODES || depth > MAX_DEPTH) throw new Error('snapshot_limit');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.length > MAX_STRING_LENGTH) throw new Error('snapshot_string');
    return value;
  }
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('snapshot_number'); return value; }
  if (typeof value !== 'object' || seen.has(value)) throw new Error('snapshot_type');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const ownKeys = Reflect.ownKeys(value);
      if (value.length > MAX_NODES || ownKeys.some(key => key !== 'length'
        && (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key)))) throw new Error('snapshot_array_keys');
      return value.map((_, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw new Error('snapshot_accessor');
        return snapshot(descriptor.value, seen, budget, depth + 1);
      });
    }
    if (!isRecord(value)) throw new Error('snapshot_object');
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some(key => typeof key !== 'string' || !Object.getOwnPropertyDescriptor(value, key)?.enumerable)) throw new Error('snapshot_keys');
    const result: PlainRecord = {};
    for (const key of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor)) throw new Error('snapshot_accessor');
      result[key] = snapshot(descriptor.value, seen, budget, depth + 1);
    }
    return result;
  } finally { seen.delete(value); }
}

function hold(...blockers: string[]): NativeMechanicalExactPrecommitDecision {
  return {
    authority: 'PRECISION_LOCAL_STRUCTURAL_GATE',
    status: 'HOLD',
    verification: 'NOT_RUN',
    authoritativeCommit: false,
    release: 'HOLD',
    blockers: [...new Set(blockers)],
  };
}

function exactKeys(value: PlainRecord, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

/** Pure precommit decision. It never persists, mutates, or claims authority. */
export function decideNativeMechanicalExactPrecommit(input: unknown): NativeMechanicalExactPrecommitDecision {
  try {
    const copied = snapshot(input);
    if (!isRecord(copied) || !exactKeys(copied, RESULT_KEYS)) return hold('INPUT_KEYS_INVALID');
    if (typeof copied.currentRegistryHash !== 'string' || !SHA256.test(copied.currentRegistryHash)) return hold('REGISTRY_HASH_INVALID');
    if (copied.currentRegistryHash !== FEATURE_REGISTRY_HASH) return hold('REGISTRY_STALE');
    if (!validateNativeMechanicalExactFeatureResult(copied.result)) return hold('EXACT_RESULT_INVALID');
    if (copied.result.status !== 'EXACT_PASS') return hold('EXACT_RESULT_HOLD');
    const command = copied.command;
    if (!isRecord(command) || validateCanonicalCadCommandV2(command).length) return hold('COMMAND_INVALID');
    const canonicalCommand = command as unknown as CanonicalCadCommandV2ConsumerDraft;
    if (hashCanonicalCadCommandV2(canonicalCommand) !== canonicalCommand.commandSha256) return hold('COMMAND_HASH_MISMATCH');
    if (canonicalCommand.actor.kind !== 'human') return hold('HUMAN_ACTOR_REQUIRED');
    const receipt = copied.result.receipt;
    if (receipt.projectId !== canonicalCommand.projectId || receipt.documentId !== canonicalCommand.documentId
      || receipt.baseRevisionId !== canonicalCommand.baseRevision.revisionId || receipt.baseSequence !== canonicalCommand.baseRevision.sequence
      || receipt.baseContentSha256 !== canonicalCommand.baseRevision.contentSha256) return hold('BASE_BINDING_MISMATCH');
    if (receipt.registryHash !== copied.currentRegistryHash) return hold('REGISTRY_STALE');
    if (receipt.operationId !== canonicalCommand.commandId || canonicalCommand.operations.length !== 1) {
      return hold('FEATURE_OPERATION_INVALID');
    }
    const feature = canonicalCommand.operations[0];
    if (!isRecord(feature) || feature.kind !== 'feature' || typeof feature.targetObjectId !== 'string'
      || !ID.test(feature.targetObjectId) || !isRecord(feature.payload) || !exactKeys(feature.payload, BINDING_KEYS)) {
      return hold('FEATURE_OPERATION_INVALID');
    }
    const payload = feature.payload;
    if (payload.schema !== NATIVE_MECHANICAL_EXACT_COMMAND_BINDING_SCHEMA
      || payload.featureId !== receipt.featureId || payload.operationId !== receipt.operationId
      || payload.registryHash !== copied.currentRegistryHash
      || payload.runtimeIdentitySha256 !== receipt.runtimeIdentitySha256
      || payload.requestSha256 !== receipt.requestSha256
      || payload.resultMeasurementSha256 !== receipt.resultMeasurementSha256
      || payload.roundtripMeasurementSha256 !== receipt.roundtripMeasurementSha256
      || payload.receiptSha256 !== receipt.receiptSha256 || payload.stepSha256 !== receipt.stepSha256
      || typeof payload.receiptArtifactId !== 'string' || !ID.test(payload.receiptArtifactId)
      || typeof payload.stepArtifactId !== 'string' || !ID.test(payload.stepArtifactId)
      || payload.receiptArtifactId === payload.stepArtifactId
      || canonicalCommand.expectedChangedObjectIds.length !== 1
      || canonicalCommand.expectedChangedObjectIds[0] !== feature.targetObjectId) return hold('OPERATION_BINDING_MISMATCH');
    const inputs = canonicalCommand.artifacts.inputs;
    const outputs = canonicalCommand.artifacts.expectedOutputs;
    if (!Array.isArray(inputs) || inputs.length !== 1 || !isRecord(inputs[0])
      || inputs[0].artifactId !== payload.receiptArtifactId || inputs[0].contentSha256 !== receipt.receiptSha256) {
      return hold('RECEIPT_DECLARATION_MISMATCH');
    }
    if (!Array.isArray(outputs) || outputs.length !== 1 || !isRecord(outputs[0])
      || outputs[0].artifactId !== payload.stepArtifactId || outputs[0].contentSha256 !== receipt.stepSha256) {
      return hold('STEP_DECLARATION_MISMATCH');
    }
    if (canonicalCommand.verification.verifierIds.length !== REQUIRED_VERIFIERS.length
      || REQUIRED_VERIFIERS.some(id => !canonicalCommand.verification.verifierIds.includes(id))
      || canonicalCommand.verification.blockers.length !== 0) {
      return hold('VERIFICATION_DECLARATION_MISMATCH');
    }
    return {
      authority: 'PRECISION_LOCAL_STRUCTURAL_GATE',
      status: 'EVIDENCE_BOUND',
      verification: 'STRUCTURAL_ONLY',
      authoritativeCommit: false,
      release: 'HOLD',
      commandId: canonicalCommand.commandId,
      receiptSha256: receipt.receiptSha256,
      stepSha256: receipt.stepSha256,
    };
  } catch { return hold('MALFORMED_INPUT'); }
}
