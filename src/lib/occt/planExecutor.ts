/**
 * planExecutor — run an OcctPlan through an OcctBridge (K1b of ADR-014).
 *
 * Pure orchestration over the (injected) OcctBridge: threads result handles by
 * resultId, folds boolean tools, applies fillet/chamfer to their target, aborts
 * on the first failed op, and releases intermediate handles. Tested with a mock
 * bridge — the real wasmBridge (worker + opencascade.wasm) plugs in unchanged.
 */

import type { OcctBridge } from './bridge';
import type { OcctShape } from './types';
import type { OcctPlan, OcctCommand } from './featurePlan';

export interface ExecuteOcctPlanResult {
  ok: boolean;
  /** The plan's final solid handle, when the run succeeded. */
  finalShape?: OcctShape;
  /** Every produced handle, keyed by resultId (intermediates are released). */
  results: Record<string, OcctShape>;
  warnings: string[];
  error?: string;
}

async function runBoolean(
  bridge: OcctBridge,
  cmd: Extract<OcctCommand, { op: 'boolean' }>,
  handles: Map<string, OcctShape>,
): Promise<{ ok: true; shape: OcctShape; warnings: string[] } | { ok: false; error: string }> {
  const base = handles.get(cmd.base);
  if (!base) return { ok: false, error: `boolean ${cmd.resultId}: base ${cmd.base} not built` };
  let acc = base;
  // W1-B/W3-A (ADR-017): thread the plan's STABLE node ids into the bridge so
  // inherited edge names are feature-scoped (`base/e.vert.0`, not the
  // positional `a/e.vert.0`) and seams are scoped per boolean. A multi-tool
  // fold runs one kernel boolean per tool, so each step gets its own opId
  // (`cut:t2`) — deterministic across rebuilds because node ids are.
  let accId = cmd.base;
  const warnings: string[] = [];
  for (const toolId of cmd.tools) {
    const tool = handles.get(toolId);
    if (!tool) return { ok: false, error: `boolean ${cmd.resultId}: tool ${toolId} not built` };
    const opId = cmd.tools.length === 1 ? cmd.resultId : `${cmd.resultId}:${toolId}`;
    const r = await bridge.boolean[cmd.kind](acc, tool, { baseId: accId, toolId, opId });
    if (!r.ok || !r.shape) return { ok: false, error: `boolean ${cmd.resultId} (${cmd.kind}): ${r.error ?? 'no shape'}` };
    warnings.push(...r.warnings);
    acc = r.shape;
    accId = opId;
  }
  return { ok: true, shape: acc, warnings };
}

/**
 * Execute the plan. `unsupported` nodes are skipped (the caller SCAD-falls-back
 * those); they don't fail the run. On the first op error the run aborts and the
 * handles built so far are released.
 */
export async function executeOcctPlan(plan: OcctPlan, bridge: OcctBridge): Promise<ExecuteOcctPlanResult> {
  const handles = new Map<string, OcctShape>();
  const warnings: string[] = [];

  const fail = (error: string): ExecuteOcctPlanResult => {
    for (const s of handles.values()) bridge.release(s);
    return { ok: false, results: {}, warnings, error };
  };

  for (const cmd of plan.commands) {
    let res: { ok: true; shape: OcctShape; warnings: string[] } | { ok: false; error: string };
    switch (cmd.op) {
      case 'extrude': {
        const r = await bridge.buildFromExtrude(cmd.feature);
        res = r.ok && r.shape ? { ok: true, shape: r.shape, warnings: r.warnings } : { ok: false, error: `extrude ${cmd.resultId}: ${r.error ?? 'no shape'}` };
        break;
      }
      case 'revolve': {
        const r = await bridge.buildFromRevolve(cmd.feature);
        res = r.ok && r.shape ? { ok: true, shape: r.shape, warnings: r.warnings } : { ok: false, error: `revolve ${cmd.resultId}: ${r.error ?? 'no shape'}` };
        break;
      }
      case 'boolean':
        res = await runBoolean(bridge, cmd, handles);
        break;
      case 'fillet': {
        const target = handles.get(cmd.target);
        if (!target) { res = { ok: false, error: `fillet ${cmd.resultId}: target ${cmd.target} not built` }; break; }
        const r = await bridge.fillet(target, cmd.edgeIds, cmd.radius);
        res = r.ok && r.shape ? { ok: true, shape: r.shape, warnings: r.warnings } : { ok: false, error: `fillet ${cmd.resultId}: ${r.error ?? 'no shape'}` };
        break;
      }
      case 'chamfer': {
        const target = handles.get(cmd.target);
        if (!target) { res = { ok: false, error: `chamfer ${cmd.resultId}: target ${cmd.target} not built` }; break; }
        const r = await bridge.chamfer(target, cmd.edgeIds, cmd.distance);
        res = r.ok && r.shape ? { ok: true, shape: r.shape, warnings: r.warnings } : { ok: false, error: `chamfer ${cmd.resultId}: ${r.error ?? 'no shape'}` };
        break;
      }
    }
    if (!res.ok) return fail(res.error);
    warnings.push(...res.warnings);
    handles.set(cmd.resultId, res.shape);
  }

  const finalShape = plan.finalResultId ? handles.get(plan.finalResultId) : undefined;
  const results: Record<string, OcctShape> = {};
  if (finalShape) results[plan.finalResultId!] = finalShape;
  // Release intermediates (everything that isn't the final handle).
  for (const [id, s] of handles) {
    if (id !== plan.finalResultId) bridge.release(s);
  }

  return { ok: true, finalShape, results, warnings };
}
