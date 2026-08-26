import {
  resolveCadMessage,
  type ResolvedCadMessage,
} from './catalog';
import {
  type CadLocale,
  type CadMessage,
} from './message';

/** Stable, locale-free issue shape emitted by the canonical sketch gates. */
export interface CanonicalSketchMachineIssue {
  code: string;
  path?: string;
}

export interface CanonicalSketchIssueMessage {
  issue: CanonicalSketchMachineIssue;
  message: CadMessage;
  resolved: ResolvedCadMessage;
}

const MAX_DEPTH = 8;
const MAX_NODES = 256;
const MAX_TEXT = 256;
const SAFE_CODE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;
const SAFE_PATH = /^[A-Za-z0-9._:/\[\]-]{1,127}$/u;
const ISSUE_KEYS = ['code', 'path'] as const;

type PlainRecord = Record<string, unknown>;

function isPlainRecord(value: unknown): value is PlainRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function hasExactKeys(value: PlainRecord): boolean {
  try {
    const keys = Reflect.ownKeys(value);
    if (keys.some(key => typeof key !== 'string')) return false;
    if (keys.some(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return !descriptor?.enumerable || !('value' in descriptor);
    })) return false;
    const actual = (keys as string[]).sort();
    const expected = [...ISSUE_KEYS].sort();
    return (actual.length === 1 && actual[0] === 'code')
      || (actual.length === expected.length
        && actual.every((key, index) => key === expected[index]));
  } catch {
    return false;
  }
}

function boundedSnapshot(
  value: unknown,
  seen = new Set<object>(),
  budget = { nodes: 0 },
  depth = 0,
): unknown {
  if (depth > MAX_DEPTH || budget.nodes++ >= MAX_NODES) throw new Error('SNAPSHOT_LIMIT');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.length > MAX_TEXT) throw new Error('SNAPSHOT_STRING_LIMIT');
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('SNAPSHOT_NUMBER');
    return value;
  }
  if (typeof value !== 'object' || seen.has(value)) throw new Error('SNAPSHOT_CYCLE_OR_TYPE');
  seen.add(value);
  if (Array.isArray(value)) {
    const keys = Reflect.ownKeys(value);
    if (keys.some(key => key !== 'length'
      && (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/u.test(key)))) {
      throw new Error('SNAPSHOT_ARRAY_KEY');
    }
    if (value.length > MAX_NODES) throw new Error('SNAPSHOT_ARRAY_LIMIT');
    const output: unknown[] = [];
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor?.enumerable || !('value' in descriptor)) throw new Error('SNAPSHOT_ACCESSOR');
      output.push(boundedSnapshot(descriptor.value, seen, budget, depth + 1));
    }
    return output;
  }
  if (!isPlainRecord(value)) throw new Error('SNAPSHOT_PROTOTYPE');
  const keys = Reflect.ownKeys(value);
  if (keys.length > MAX_NODES || keys.some(key => typeof key !== 'string')) {
    throw new Error('SNAPSHOT_OBJECT_KEY');
  }
  const output: PlainRecord = {};
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) throw new Error('SNAPSHOT_ACCESSOR');
    output[key] = boundedSnapshot(descriptor.value, seen, budget, depth + 1);
  }
  return output;
}

function rejectProxy(value: unknown): void {
  const clone = (globalThis as { structuredClone?: (input: unknown) => unknown }).structuredClone;
  if (typeof clone !== 'function') return;
  try {
    clone(value);
  } catch {
    throw new Error('SNAPSHOT_PROXY');
  }
}

function safeIssue(value: unknown): CanonicalSketchMachineIssue {
  if (!isPlainRecord(value) || !hasExactKeys(value)) return { code: 'ISSUE_INVALID' };
  const code = value.code;
  if (typeof code !== 'string' || !SAFE_CODE.test(code)) return { code: 'ISSUE_INVALID' };
  const path = value.path;
  if (path === undefined) return { code };
  return typeof path === 'string' && SAFE_PATH.test(path) ? { code, path } : { code };
}

function invalidIssue(): CanonicalSketchMachineIssue {
  return { code: 'ISSUE_INVALID' };
}

function issueParam(issue: CanonicalSketchMachineIssue): string {
  return issue.path ? `${issue.code}@${issue.path}` : issue.code;
}

function mapCode(code: string): { code: CadMessage['code']; param: string } {
  if (/UNSUPPORTED/u.test(code)) return { code: 'CAD_FEATURE_UNSUPPORTED', param: 'feature' };
  if (/SCHEMA|VERSION/u.test(code)) return { code: 'CAD_ARTIFACT_VERSION_MISMATCH', param: 'version' };
  if (/^SOLVER_(NONDETERMINISTIC|NONFINITE|INCONSISTENT|OVER_DEFINED|NOT_SATISFIED|STATUS_INVALID)|^OUTPUT_(STRUCTURAL_INVALID|TOPOLOGY_CHANGED)/u.test(code)) {
    return { code: 'CAD_VERIFICATION_FAILED', param: 'check' };
  }
  if (/^PREFLIGHT_|STRUCTURAL/u.test(code)) return { code: 'CAD_PREFLIGHT_HOLD', param: 'reason' };
  if (/INPUT|REF|KEY|SNAPSHOT|RESOURCE|EMPTY_EFFECTIVE|ISSUE_INVALID/u.test(code)) {
    return { code: 'CAD_INPUT_INVALID', param: 'reason' };
  }
  return { code: 'CAD_INPUT_INVALID', param: 'reason' };
}

function adaptDetachedIssue(issue: CanonicalSketchMachineIssue, locale: string | null | undefined): CanonicalSketchIssueMessage {
  const mapping = mapCode(issue.code);
  const parameter = issueParam(issue);
  let message: CadMessage;
  switch (mapping.code) {
    case 'CAD_FEATURE_UNSUPPORTED':
      message = { code: 'CAD_FEATURE_UNSUPPORTED', params: { feature: parameter } };
      break;
    case 'CAD_ARTIFACT_VERSION_MISMATCH':
      message = { code: 'CAD_ARTIFACT_VERSION_MISMATCH', params: { version: parameter } };
      break;
    case 'CAD_VERIFICATION_FAILED':
      message = { code: 'CAD_VERIFICATION_FAILED', params: { check: parameter } };
      break;
    case 'CAD_PREFLIGHT_HOLD':
      message = { code: 'CAD_PREFLIGHT_HOLD', params: { reason: parameter } };
      break;
    default:
      message = { code: 'CAD_INPUT_INVALID', params: { reason: parameter } };
      break;
  }
  return {
    issue,
    message,
    resolved: resolveCadMessage(message, locale),
  };
}

/** Convert one canonical issue without ever exposing unbounded user text. */
export function canonicalSketchIssueToCadMessage(
  value: unknown,
  locale: CadLocale | string | null | undefined,
): CanonicalSketchIssueMessage {
  try {
    const snapshot = boundedSnapshot(value);
    rejectProxy(value);
    return adaptDetachedIssue(safeIssue(snapshot), locale);
  } catch {
    return adaptDetachedIssue(invalidIssue(), locale);
  }
}

/** Stable-order adapter for a bounded issue collection. */
export function canonicalSketchIssuesToCadMessages(
  value: unknown,
  locale: CadLocale | string | null | undefined,
): ReadonlyArray<CanonicalSketchIssueMessage> {
  try {
    const snapshot = boundedSnapshot(value);
    rejectProxy(value);
    if (!Array.isArray(snapshot) || snapshot.length > MAX_NODES) {
      return [adaptDetachedIssue({ code: 'ISSUE_INVALID' }, locale)];
    }
    return snapshot.map(item => adaptDetachedIssue(safeIssue(item), locale));
  } catch {
    return [adaptDetachedIssue(invalidIssue(), locale)];
  }
}
