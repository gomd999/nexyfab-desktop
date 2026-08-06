import type { FeatureTree } from '@/lib/cad/featureTree';
import type { AssemblySelectionEditPreview } from './assemblySelectionEdit';
import { loadOcctNode } from '@/lib/occt/nodeOcctLoader';
import { createNodeOcctBridge } from '@/lib/occt/nodeOcctBridge';
import { featureTreeToOcctPlan } from '@/lib/occt/featurePlan';
import { executeOcctPlan } from '@/lib/occt/planExecutor';

type ExactMeasurement = {
  volumeMm3: number;
  bbox: { min: { x:number;y:number;z:number }; max: { x:number;y:number;z:number } };
  solidCount: number;
  faceCount: number;
  edgeCount: number;
  valid: boolean;
};

/**
 * Promote estimate evidence to exact OCCT B-rep evidence. Planning remains
 * synchronous/deterministic; this optional server-side gate performs the
 * expensive kernel replay and fails closed without changing the edit result.
 */
export async function verifyAssemblySelectionEditBrep(
  preview: AssemblySelectionEditPreview,
  originalTrees: Record<string, FeatureTree>,
): Promise<AssemblySelectionEditPreview> {
  const base = preview.evidence;
  if (!base) return preview;
  const beforeTree = originalTrees[base.partId];
  const afterTree = preview.nextFeatureTrees[base.partId];
  if (!beforeTree || !afterTree) return preview;

  const fail = (kernelError: string): AssemblySelectionEditPreview => ({
    ...preview,
    evidence: { ...base, method: 'exact-brep', topologyValidation: 'failed', kernelError },
  });
  const beforePlan = featureTreeToOcctPlan(beforeTree);
  const afterPlan = featureTreeToOcctPlan(afterTree);
  const unsupported = [...beforePlan.unsupported, ...afterPlan.unsupported];
  if (unsupported.length) return fail(`OCCT plan unsupported: ${unsupported.map((item) => `${item.resultId}:${item.kind}`).join(', ')}`);

  const loaded = await loadOcctNode();
  if (!loaded.ok || !loaded.oc) return fail(`OCCT unavailable: ${loaded.reason ?? 'module did not load'}`);
  const bridge = createNodeOcctBridge(loaded.oc);
  if (!bridge.inspectShape) return fail('OCCT bridge has no exact topology inspector');

  const measure = async (treePlan: typeof beforePlan): Promise<ExactMeasurement> => {
    const run = await executeOcctPlan(treePlan, bridge);
    if (!run.ok || !run.finalShape) throw new Error(run.error ?? 'OCCT plan produced no final shape');
    const shape = run.finalShape;
    try {
      if (!Number.isFinite(shape.volume) || !shape.bbox) throw new Error('OCCT shape has no finite solid measurement');
      const topology = await bridge.inspectShape!(shape);
      return { volumeMm3: shape.volume!, bbox: shape.bbox, ...topology };
    } finally {
      bridge.release(shape);
    }
  };

  try {
    const before = await measure(beforePlan);
    const after = await measure(afterPlan);
    const passed = before.valid && after.valid && before.solidCount > 0 && after.solidCount > 0;
    return {
      ...preview,
      evidence: {
        ...base,
        method: 'exact-brep',
        before,
        after,
        deltaVolumeMm3: after.volumeMm3 - before.volumeMm3,
        topologyValidation: passed ? 'passed' : 'failed',
        ...(passed ? {} : { kernelError: 'BRepCheck or solid-count validation failed' }),
      },
    };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}
