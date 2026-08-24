export const CAD_LOCALES = ['ko', 'en', 'ja', 'zh', 'es', 'ar'] as const;
export type CadLocale = (typeof CAD_LOCALES)[number];
export type MessageParam = string | number;

/** Stable machine codes for the GP02–GP05 fail-closed boundaries. */
export const CAD_MESSAGE_CODES = [
  'CAD_INPUT_INVALID',
  'CAD_PERMISSION_DENIED',
  'CAD_LOCK_CONFLICT',
  'CAD_REVISION_STALE',
  'CAD_MIGRATION_REQUIRED',
  'CAD_PREFLIGHT_HOLD',
  'CAD_FEATURE_REGISTRY_MISMATCH',
  'CAD_RUNTIME_IDENTITY_MISMATCH',
  'CAD_VERIFICATION_FAILED',
  'CAD_RELEASE_HOLD',
  'CAD_FEATURE_UNSUPPORTED',
  'CAD_EXACT_KERNEL_UNAVAILABLE',
  'CAD_ARTIFACT_VERSION_MISMATCH',
  'CAD_RECEIPT_INVALID',
] as const;
export type CadMessageCode = (typeof CAD_MESSAGE_CODES)[number];

export type CadMessage =
  | { code: 'CAD_INPUT_INVALID'; params: Readonly<{ reason: string }>; detail?: string }
  | { code: 'CAD_PERMISSION_DENIED'; params: Readonly<{ action: string }>; detail?: string }
  | { code: 'CAD_LOCK_CONFLICT'; params: Readonly<{ resource: string }>; detail?: string }
  | { code: 'CAD_REVISION_STALE'; params: Readonly<{ revision: MessageParam }>; detail?: string }
  | { code: 'CAD_MIGRATION_REQUIRED'; params: Readonly<{ version: MessageParam }>; detail?: string }
  | { code: 'CAD_PREFLIGHT_HOLD'; params: Readonly<{ reason: string }>; detail?: string }
  | { code: 'CAD_FEATURE_REGISTRY_MISMATCH'; params: Readonly<{ registry: string }>; detail?: string }
  | { code: 'CAD_RUNTIME_IDENTITY_MISMATCH'; params: Readonly<{ field: string }>; detail?: string }
  | { code: 'CAD_VERIFICATION_FAILED'; params: Readonly<{ check: string }>; detail?: string }
  | { code: 'CAD_RELEASE_HOLD'; params: Readonly<{ reason: string }>; detail?: string }
  | { code: 'CAD_FEATURE_UNSUPPORTED'; params: Readonly<{ feature: string }>; detail?: string }
  | { code: 'CAD_EXACT_KERNEL_UNAVAILABLE'; params?: never; detail?: string }
  | { code: 'CAD_ARTIFACT_VERSION_MISMATCH'; params: Readonly<{ version: MessageParam }>; detail?: string }
  | { code: 'CAD_RECEIPT_INVALID'; params: Readonly<{ reason: string }>; detail?: string };

const PARAM_KEYS = {
  CAD_INPUT_INVALID: ['reason'],
  CAD_PERMISSION_DENIED: ['action'],
  CAD_LOCK_CONFLICT: ['resource'],
  CAD_REVISION_STALE: ['revision'],
  CAD_MIGRATION_REQUIRED: ['version'],
  CAD_PREFLIGHT_HOLD: ['reason'],
  CAD_FEATURE_REGISTRY_MISMATCH: ['registry'],
  CAD_RUNTIME_IDENTITY_MISMATCH: ['field'],
  CAD_VERIFICATION_FAILED: ['check'],
  CAD_RELEASE_HOLD: ['reason'],
  CAD_FEATURE_UNSUPPORTED: ['feature'],
  CAD_EXACT_KERNEL_UNAVAILABLE: [],
  CAD_ARTIFACT_VERSION_MISMATCH: ['version'],
  CAD_RECEIPT_INVALID: ['reason'],
} as const satisfies Record<CadMessageCode, readonly string[]>;

const MAX_PARAM_TEXT = 256;
const MAX_DETAIL_TEXT = 1000;
const MESSAGE_KEYS = ['code', 'detail', 'params'] as const;

type PlainRecord = Record<string, unknown>;

function isPlainRecord(value: unknown): value is PlainRecord {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    for (const key of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function dataValue(record: PlainRecord, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

function isSafeText(value: unknown, max: number, allowEmpty = false): value is string {
  return typeof value === 'string'
    && value.length <= max
    && (allowEmpty || value.trim().length > 0)
    && !/[<>]/u.test(value)
    && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value);
}

function fail(code: string): never {
  throw new Error(code);
}

export function cadMessageParamKeys(code: CadMessageCode): readonly string[] {
  return PARAM_KEYS[code];
}

export function isCadLocale(value: unknown): value is CadLocale {
  return typeof value === 'string' && (CAD_LOCALES as readonly string[]).includes(value);
}

export function isCadMessageCode(value: unknown): value is CadMessageCode {
  return typeof value === 'string' && (CAD_MESSAGE_CODES as readonly string[]).includes(value);
}

/** Validate and detach a machine message so accessors/proxies cannot escape. */
export function assertCadMessage(input: unknown): CadMessage {
  try {
    if (!isPlainRecord(input)) fail('invalid_cad_message');
    const actualKeys = Object.keys(input).sort();
    if (actualKeys.some(key => !(MESSAGE_KEYS as readonly string[]).includes(key))) fail('invalid_cad_message_keys');
    const codeValue = dataValue(input, 'code');
    if (typeof codeValue !== 'string' || !isCadMessageCode(codeValue)) {
      fail(`unknown_cad_message_code:${String(codeValue)}`);
    }
    const detail = dataValue(input, 'detail');
    if (detail !== undefined && !isSafeText(detail, MAX_DETAIL_TEXT, true)) fail('invalid_cad_message_detail');

    const code = codeValue;
    const required = cadMessageParamKeys(code);
    const params = dataValue(input, 'params');
    if (!required.length) {
      if (params !== undefined) fail('unexpected_cad_message_params');
    } else {
      if (!isPlainRecord(params)) fail('invalid_cad_message_params');
      const keys = Object.keys(params).sort();
      const expected = [...required].sort();
      if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
        fail('invalid_cad_message_param_keys');
      }
      for (const key of required) {
        const value = dataValue(params, key);
        const validString = typeof value === 'string' && isSafeText(value, MAX_PARAM_TEXT);
        const validNumber = typeof value === 'number' && Number.isFinite(value);
        if (!validString && !validNumber) fail(`invalid_cad_message_param:${key}`);
      }
    }

    const detached: Record<string, unknown> = { code };
    if (detail !== undefined) detached.detail = detail;
    if (required.length) {
      const detachedParams: Record<string, MessageParam> = {};
      for (const key of required) detachedParams[key] = dataValue(params!, key) as MessageParam;
      detached.params = detachedParams;
    }
    return detached as CadMessage;
  } catch (error) {
    if (error instanceof Error && /^(invalid_|unexpected_|unknown_cad_message_code)/u.test(error.message)) throw error;
    throw new Error('invalid_cad_message');
  }
}
