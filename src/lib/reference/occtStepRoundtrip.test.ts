import { describe, expect, it } from 'vitest';
import { roundtripStepWithOcct } from './occtStepRoundtrip';

describe('isolated OCCT STEP roundtrip', () => {
  it('fails closed on invalid STEP input', async () => {
    const result = await roundtripStepWithOcct(new TextEncoder().encode('not a STEP'), 20_000);
    expect(result.ok).toBe(false);
    expect(result.exportedStep).toBeNull();
    expect(result.geometry.pass).toBe(false);
  }, 30_000);
});

