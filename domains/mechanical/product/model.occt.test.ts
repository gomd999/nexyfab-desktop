import { beforeAll, describe, expect, it } from 'vitest';
import type { OcctBridge } from '@/lib/occt/bridge';
import { featureTreeToOcctPlan } from '@/lib/occt/featurePlan';
import { createNodeOcctBridge } from '@/lib/occt/nodeOcctBridge';
import { loadOcctNode } from '@/lib/occt/nodeOcctLoader';
import { executeOcctPlan } from '@/lib/occt/planExecutor';
import { buildMotorGearboxDriveModuleModel } from './model';

let bridge: OcctBridge;

describe('mechanical drive-module real OCCT execution', () => {
  beforeAll(async () => {
    const loaded = await loadOcctNode();
    if (!loaded.ok || !loaded.oc) throw new Error(`real_occt_unavailable:${loaded.reason ?? 'unknown'}`);
    bridge = createNodeOcctBridge(loaded.oc);
  }, 60_000);

  it('builds and STEP round-trips every contract part without a preview fallback', async () => {
    const model = buildMotorGearboxDriveModuleModel();
    for (const part of model.contract.parts) {
      const plan = featureTreeToOcctPlan(model.featureTrees[part.id]!);
      expect(plan.unsupported, part.id).toEqual([]);
      const execution = await executeOcctPlan(plan, bridge);
      expect(execution.ok, `${part.id}:${execution.error ?? 'execution failed'}`).toBe(true);
      expect(execution.finalShape, part.id).toBeDefined();
      const step = await bridge.exportSTEP(execution.finalShape!);
      expect(step.startsWith('ISO-10303-21;'), part.id).toBe(true);
      const imported = await bridge.importSTEP(step);
      expect(imported.ok, part.id).toBe(true);
      if (imported.ok && imported.shape) bridge.release(imported.shape);
      bridge.release(execution.finalShape!);
    }
  }, 60_000);
});
