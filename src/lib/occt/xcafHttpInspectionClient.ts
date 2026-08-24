import 'server-only';
import { createHash } from 'node:crypto';
import {
  validateXcafInspection,
  type XcafInspectionResult,
} from './xcafCanonicalBinding';

const SHA256 = /^[a-f0-9]{64}$/;
const STEP_HEADER = new TextEncoder().encode('ISO-10303-21;');
const MAX_STEP_BYTES = 4 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 50_000;
const MIN_TOKEN_LENGTH = 32;
const MAX_TOKEN_LENGTH = 512;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface XcafHttpInspector {
  inspect(input: { inputBytes: Uint8Array; sha256: string }): Promise<XcafInspectionResult>;
}

export type XcafHttpInspectorLoadResult =
  | { ok: true; inspector: XcafHttpInspector }
  | { ok: false; reason: 'XCAF_SERVICE_CONFIG_HOLD' };

class XcafHttpInspectionError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'XcafHttpInspectionError';
  }
}

function validToken(value: string | undefined): value is string {
  return typeof value === 'string'
    && value.length >= MIN_TOKEN_LENGTH
    && value.length <= MAX_TOKEN_LENGTH
    && !/[\r\n]/.test(value);
}

function normalizeServiceUrl(value: string | undefined): string | null {
  if (!value || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)
      || url.username || url.password || url.search || url.hash
      || (url.pathname !== '' && url.pathname !== '/')) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (!contentType.toLowerCase().startsWith('application/json')
    || (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES)
    || !response.body) throw new XcafHttpInspectionError('XCAF_RESPONSE_INVALID');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_RESPONSE_BYTES) throw new XcafHttpInspectionError('XCAF_RESPONSE_TOO_LARGE');
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new XcafHttpInspectionError('XCAF_RESPONSE_MALFORMED');
  }
}

export function createXcafHttpInspector(input: {
  serviceUrl: string;
  serviceToken: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}): XcafHttpInspector {
  const serviceUrl = normalizeServiceUrl(input.serviceUrl);
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!serviceUrl || !validToken(input.serviceToken)
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) {
    throw new Error('XCAF_SERVICE_CONFIG_INVALID');
  }
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('XCAF_SERVICE_FETCH_UNAVAILABLE');
  const token = input.serviceToken;
  return Object.freeze({
    async inspect(request: { inputBytes: Uint8Array; sha256: string }): Promise<XcafInspectionResult> {
      if (!(request.inputBytes instanceof Uint8Array)
        || request.inputBytes.byteLength < 1 || request.inputBytes.byteLength > MAX_STEP_BYTES
        || !SHA256.test(request.sha256) || digest(request.inputBytes) !== request.sha256) {
        throw new XcafHttpInspectionError('XCAF_REQUEST_INVALID');
      }
      if (request.inputBytes.byteLength < STEP_HEADER.byteLength
        || STEP_HEADER.some((byte, index) => request.inputBytes[index] !== byte)) {
        throw new XcafHttpInspectionError('XCAF_STEP_INVALID');
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(`${serviceUrl}/v1/inspect`, {
          method: 'POST',
          cache: 'no-store',
          redirect: 'error',
          signal: controller.signal,
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            inputBase64: Buffer.from(request.inputBytes).toString('base64'),
            sha256: request.sha256,
            timeoutMs,
          }),
        });
        if (!response.ok) throw new XcafHttpInspectionError('XCAF_SERVICE_REJECTED');
        const inspection = await readBoundedJson(response);
        const issues = validateXcafInspection(inspection);
        if (issues.length > 0
          || (inspection as XcafInspectionResult).inputSha256 !== request.sha256) {
          throw new XcafHttpInspectionError('XCAF_INSPECTION_INVALID');
        }
        return inspection as XcafInspectionResult;
      } catch (error) {
        if (error instanceof XcafHttpInspectionError) throw error;
        throw new XcafHttpInspectionError('XCAF_SERVICE_UNAVAILABLE');
      } finally {
        clearTimeout(timer);
      }
    },
  });
}

/** Production factory. URL and credential are server environment authority only. */
export function loadXcafHttpInspectorFromEnvironment(
  environment: Record<string, string | undefined> = process.env,
  fetchImpl?: FetchLike,
): XcafHttpInspectorLoadResult {
  const serviceUrl = normalizeServiceUrl(environment.OCCT_XCAF_SERVICE_URL);
  const token = environment.OCCT_XCAF_SERVICE_TOKEN;
  if (!serviceUrl || !validToken(token)) return { ok: false, reason: 'XCAF_SERVICE_CONFIG_HOLD' };
  try {
    return { ok: true, inspector: createXcafHttpInspector({ serviceUrl, serviceToken: token, fetchImpl }) };
  } catch {
    return { ok: false, reason: 'XCAF_SERVICE_CONFIG_HOLD' };
  }
}
