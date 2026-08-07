export const DEFAULT_MAX_STEP_BYTES = 200 * 1024 * 1024;
const STEP_START = 'ISO-10303-21;';
const STEP_END = 'END-ISO-10303-21;';

export type StepInputIssue = 'empty' | 'too-large' | 'bad-extension' | 'bad-header' | 'truncated';

export class StepInputError extends Error {
  constructor(public readonly issue: StepInputIssue, message: string) {
    super(message);
    this.name = 'StepInputError';
  }
}

/** Cheap validation before ownership of the ArrayBuffer is transferred to WASM. */
export function assertStepInput(
  buffer: ArrayBuffer,
  filename: string,
  maxBytes = DEFAULT_MAX_STEP_BYTES,
): void {
  if (buffer.byteLength === 0) throw new StepInputError('empty', 'STEP file is empty');
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new TypeError('maxBytes must be a positive safe integer');
  if (buffer.byteLength > maxBytes) {
    throw new StepInputError('too-large', `STEP file exceeds the ${(maxBytes / 1024 / 1024).toFixed(0)}MB upload limit`);
  }
  if (!/\.(?:step|stp)$/i.test(filename.trim())) {
    throw new StepInputError('bad-extension', 'STEP filename must end in .step or .stp');
  }

  const decoder = new TextDecoder('utf-8');
  const head = decoder.decode(buffer.slice(0, Math.min(buffer.byteLength, 4096))).replace(/^\uFEFF/, '').trimStart();
  if (!head.startsWith(STEP_START)) {
    throw new StepInputError('bad-header', `STEP header must begin with ${STEP_START}`);
  }
  const tailStart = Math.max(0, buffer.byteLength - 4096);
  const tail = decoder.decode(buffer.slice(tailStart)).trimEnd();
  if (!tail.endsWith(STEP_END)) {
    throw new StepInputError('truncated', `STEP file is incomplete; missing ${STEP_END}`);
  }
}
