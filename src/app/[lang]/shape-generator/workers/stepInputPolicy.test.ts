import { describe, expect, it } from 'vitest';
import { assertStepInput, StepInputError } from './stepInputPolicy';

const encode = (value: string) => new TextEncoder().encode(value).buffer as ArrayBuffer;
const valid = encode('ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;');

describe('STEP input policy', () => {
  it('accepts standard STEP/STP envelopes case-insensitively', () => {
    expect(() => assertStepInput(valid, 'part.STP')).not.toThrow();
  });
  it.each([
    ['empty', new ArrayBuffer(0), 'part.step'],
    ['bad-extension', valid, 'part.zip'],
    ['bad-header', encode('solid ascii stl'), 'part.step'],
    ['truncated', encode('ISO-10303-21;\nHEADER;'), 'part.step'],
  ] as const)('rejects %s input before worker transfer', (issue, buffer, filename) => {
    try { assertStepInput(buffer, filename); throw new Error('expected rejection'); }
    catch (error) { expect(error).toBeInstanceOf(StepInputError); expect((error as StepInputError).issue).toBe(issue); }
  });
  it('enforces a configurable byte ceiling', () => {
    expect(() => assertStepInput(valid, 'part.step', valid.byteLength - 1)).toThrow(/upload limit/i);
  });
});
