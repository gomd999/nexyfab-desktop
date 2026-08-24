import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ensureOcctReady,
  exportOcctStep,
  occtImportStepText,
  resetShapeRegistry,
  setOcctGlobalMode,
} from '../features/occtEngine';
import { captureStepSemanticIdentity } from './stepSemanticIdentity';

const SOURCE = path.join(
  process.cwd(),
  'docs/evidence/cad-independent/local/mechanical-step-c4-260814/source.step',
);

describe('OCCT STEP semantic roundtrip', () => {
  afterEach(() => {
    resetShapeRegistry();
    setOcctGlobalMode(false);
  });

  it('preserves the bound AP242 product and occurrence identity on open-export', async () => {
    const source = fs.readFileSync(SOURCE, 'utf8');
    const expected = captureStepSemanticIdentity(source);
    expect(expected?.occurrences).toHaveLength(2);

    await ensureOcctReady();
    setOcctGlobalMode(true);
    const opened = await occtImportStepText(source);
    expect(opened.handle).not.toBeNull();

    const returned = await exportOcctStep(opened.handle);
    expect(returned).not.toBeNull();
    expect(captureStepSemanticIdentity(returned!)).toEqual(expected);
    expect(returned).toContain("PRODUCT('base-plate','base-plate'");
    expect(returned).toContain("NEXT_ASSEMBLY_USAGE_OCCURRENCE('NexyFab_C4_Box_Assembly_2','Mount Block'");
  });
});
