/**
 * stepImportKSeries — import a STEP file as a true OCCT B-rep solid (gap #3),
 * instead of the occt-import-js → tessellated-mesh path the default importer
 * uses. Reads the STEP natively via STEPControl_Reader (K-series worker), so the
 * result is a real B-rep shape (accurate volume/bbox, re-exportable, usable by
 * the kernel-ceiling ops) — then tessellates it for the viewport.
 *
 * Verified end-to-end headlessly by `solidKernelStep.kseries.test.ts`
 * (extrude → exportStep → importStep recovers the same volume). Browser-only
 * (spawns the OCCT worker). Never throws — returns a tagged outcome.
 */
import type { ShapeResult } from '../shapes';
import { selectSolidKernel } from './solidKernelBindings';
import { tessellationToShapeResult } from './thickenKSeries';

export type StepImportOutcome =
  | { ok: true; result: ShapeResult; warnings: string[] }
  | { ok: false; error: string };

export async function importStepKSeries(stepText: string, deflection = 0.1): Promise<StepImportOutcome> {
  if (!stepText || stepText.trim().length === 0) {
    return { ok: false, error: 'STEP source is empty' };
  }
  const kernel = selectSolidKernel(true);
  let solidId: string | null = null;
  try {
    const solid = await kernel.importStep(stepText);
    if (!solid) return { ok: false, error: 'STEP read failed (no transferable B-rep roots)' };
    solidId = solid.id;
    const tess = await kernel.tessellate(solid.id, deflection);
    if (!tess) return { ok: false, error: 'tessellate returned no mesh for the imported solid' };
    return {
      ok: true,
      result: tessellationToShapeResult(tess, { volumeMm3: solid.volume, bbox: solid.bbox }),
      warnings: [],
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    if (solidId) kernel.release(solidId);
  }
}
