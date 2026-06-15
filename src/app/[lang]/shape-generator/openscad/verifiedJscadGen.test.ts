// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { generateVerifiedJscad } from './verifiedJscadGen';
import { runJscadCode } from './jscadRunner';

// Real in-process renderer (same one the panel uses) → a watertight cuboid,
// which Layer-1 verification accepts. Throws on broken code.
const render = (code: string) => Promise.resolve(runJscadCode(code).geometry);

const GOOD = `const { cuboid } = jscad.primitives; function main() { return cuboid({ size: [10, 10, 10] }); }`;
const BROKEN = `function main() { return totallyUndefinedThing(); }`;

describe('generateVerifiedJscad — render-verify-repair loop', () => {
  it('repairs a broken first generation and converges (render error fed back)', async () => {
    const aiGenerate = vi.fn()
      .mockResolvedValueOnce({ code: BROKEN, description: 'attempt 1' })
      .mockResolvedValueOnce({ code: GOOD, description: 'a 10mm cube' });

    const res = await generateVerifiedJscad('a 10mm cube', { aiGenerate, render }, { maxAttempts: 3 });

    expect(res.ok).toBe(true);
    expect(res.attempts).toBe(2);
    expect(res.code).toContain('cuboid');
    expect(res.description).toBe('a 10mm cube');
    expect(res.geometry).toBeTruthy();
    // The repair call must have received the prior code + a blocking critique.
    const repairArgs = aiGenerate.mock.calls[1][0];
    expect(repairArgs.priorCode).toBe(BROKEN);
    expect(repairArgs.critique).toMatch(/RENDER ERROR|error/i);
    expect(repairArgs.attempt).toBe(2);
  });

  it('first-shot success needs no repair', async () => {
    const aiGenerate = vi.fn().mockResolvedValue({ code: GOOD, description: 'cube' });
    const res = await generateVerifiedJscad('cube', { aiGenerate, render }, { maxAttempts: 3 });
    expect(res.ok).toBe(true);
    expect(res.attempts).toBe(1);
    expect(aiGenerate).toHaveBeenCalledTimes(1);
  });

  it('gives up after maxAttempts when every generation is broken (no false success)', async () => {
    const aiGenerate = vi.fn().mockResolvedValue({ code: BROKEN, description: 'bad' });
    const res = await generateVerifiedJscad('impossible', { aiGenerate, render }, { maxAttempts: 2 });
    expect(res.ok).toBe(false);
    expect(res.attempts).toBe(2);
    expect(res.finalCritique).toMatch(/RENDER ERROR|error/i);
  });
});
