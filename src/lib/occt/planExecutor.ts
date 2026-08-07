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

function circleLoop(cx: number, cy: number, diameter: number, segments = 64): Array<{ x: number; y: number }> {
  const radius = diameter / 2;
  return Array.from({ length: segments }, (_, index) => {
    const angle = (2 * Math.PI * index) / segments;
    return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
  });
}

async function runHole(
  bridge: OcctBridge,
  cmd: Extract<OcctCommand, { op: 'hole' }>,
  handles: Map<string, OcctShape>,
): Promise<{ ok: true; shape: OcctShape; warnings: string[] } | { ok: false; error: string }> {
  const target = handles.get(cmd.target);
  if (!target) return { ok: false, error: `hole ${cmd.resultId}: target ${cmd.target} not built` };
  if (!bridge.buildPrismAt) return { ok: false, error: `hole ${cmd.resultId}: bridge has no buildPrismAt` };
  const top = target.bbox?.max.z;
  if (!Number.isFinite(top)) return { ok: false, error: `hole ${cmd.resultId}: target top Z unavailable` };
  const h = cmd.feature;
  if (![h.center.x, h.center.y, h.diameter, h.depth].every(Number.isFinite) || h.diameter <= 0 || h.depth <= 0) {
    return { ok: false, error: `hole ${cmd.resultId}: invalid center/diameter/depth` };
  }
  const bottom = target.bbox?.min.z;
  const targetDepth = Number.isFinite(bottom) ? top! - bottom! : undefined;
  const isBlind = h.terminationMode === 'blind' ||
    (h.terminationMode !== 'through' && Number.isFinite(targetDepth) && h.depth < targetDepth! - 0.01);
  if (h.terminationMode === 'through' && !Number.isFinite(targetDepth)) {
    return { ok: false, error: `hole ${cmd.resultId}: through termination requires target bottom Z` };
  }
  const mainDepth = h.terminationMode === 'through' ? targetDepth! : h.depth;
  const cuts = [{ diameter: h.diameter, depth: mainDepth }];
  const drillTipAngle = h.drillTipAngleDegrees ?? 118;
  if (isBlind && (!Number.isFinite(drillTipAngle) || drillTipAngle < 60 || drillTipAngle >= 180)) {
    return { ok: false, error: `hole ${cmd.resultId}: drill tip angle must be in [60, 180) degrees` };
  }
  const drillTipHeight = isBlind
    ? (h.diameter / 2) / Math.tan((drillTipAngle * Math.PI) / 360)
    : 0;
  if (isBlind && mainDepth <= drillTipHeight) {
    return { ok: false, error: `hole ${cmd.resultId}: depth must exceed drill tip height ${drillTipHeight.toFixed(3)} mm` };
  }
  if (isBlind) cuts[0] = { diameter: h.diameter, depth: mainDepth - drillTipHeight };
  if (h.holeType === 'counterbore') {
    if (!Number.isFinite(h.counterboreDiameter) || !Number.isFinite(h.counterboreDepth) || h.counterboreDiameter! <= h.diameter || h.counterboreDepth! <= 0) {
      return { ok: false, error: `hole ${cmd.resultId}: invalid counterbore dimensions` };
    }
    cuts.push({ diameter: h.counterboreDiameter!, depth: h.counterboreDepth! });
  }
  const warnings: string[] = [];
  let acc = target;
  const epsilon = 0.01;
  const seamEpsilon = 1e-5;
  for (let index = 0; index < cuts.length; index++) {
    const cut = cuts[index]!;
    const lowerOverlap = isBlind && index === 0 ? seamEpsilon : epsilon;
    const toolResult = await bridge.buildPrismAt(
      circleLoop(h.center.x, h.center.y, cut.diameter),
      top! - cut.depth - lowerOverlap,
      cut.depth + lowerOverlap + epsilon,
    );
    if (!toolResult.ok || !toolResult.shape) return { ok: false, error: `hole ${cmd.resultId}: tool build failed: ${toolResult.error ?? 'no shape'}` };
    const tool = toolResult.shape;
    const result = await bridge.boolean.subtract(acc, tool, { baseId: index === 0 ? cmd.target : `${cmd.resultId}:bore`, toolId: `${cmd.resultId}:tool:${index}`, opId: `${cmd.resultId}:cut:${index}` });
    bridge.release(tool);
    if (!result.ok || !result.shape) return { ok: false, error: `hole ${cmd.resultId}: cut failed: ${result.error ?? 'no shape'}` };
    if (acc !== target) bridge.release(acc);
    acc = result.shape;
    warnings.push(...toolResult.warnings, ...result.warnings);
  }
  if (isBlind) {
    if (!bridge.buildConeAt) return { ok: false, error: `hole ${cmd.resultId}: bridge has no buildConeAt for drill tip` };
    const apexZ = top! - mainDepth;
    const toolResult = await bridge.buildConeAt(h.center, apexZ, drillTipHeight + seamEpsilon, 0, h.diameter / 2);
    if (!toolResult.ok || !toolResult.shape) return { ok: false, error: `hole ${cmd.resultId}: drill tip build failed: ${toolResult.error ?? 'no shape'}` };
    const tool = toolResult.shape;
    const result = await bridge.boolean.subtract(acc, tool, {
      baseId: `${cmd.resultId}:bore`, toolId: `${cmd.resultId}:drill-tip-tool`, opId: `${cmd.resultId}:drill-tip-cut`,
    });
    bridge.release(tool);
    if (!result.ok || !result.shape) return { ok: false, error: `hole ${cmd.resultId}: drill tip cut failed: ${result.error ?? 'no shape'}` };
    if (acc !== target) bridge.release(acc);
    acc = result.shape;
    warnings.push(...toolResult.warnings, ...result.warnings, `blind drill tip: ${drillTipAngle} degrees`);
  }
  if (h.holeType === 'countersink') {
    if (!bridge.buildConeAt) return { ok: false, error: `hole ${cmd.resultId}: bridge has no buildConeAt` };
    const angle = h.countersinkAngleDegrees;
    const depth = h.countersinkDepth;
    if (!Number.isFinite(angle) || !Number.isFinite(depth) || depth! <= 0 || angle! < 82 || angle! > 135) {
      return { ok: false, error: `hole ${cmd.resultId}: invalid countersink dimensions` };
    }
    const bottomRadius = h.diameter / 2;
    const topRadius = bottomRadius + depth! * Math.tan((angle! * Math.PI) / 360);
    const toolResult = await bridge.buildConeAt(h.center, top! - depth! - epsilon, depth! + 2 * epsilon, bottomRadius, topRadius);
    if (!toolResult.ok || !toolResult.shape) return { ok: false, error: `hole ${cmd.resultId}: countersink tool failed: ${toolResult.error ?? 'no shape'}` };
    const tool = toolResult.shape;
    const result = await bridge.boolean.subtract(acc, tool, { baseId: `${cmd.resultId}:bore`, toolId: `${cmd.resultId}:countersink-tool`, opId: `${cmd.resultId}:countersink-cut` });
    bridge.release(tool);
    if (!result.ok || !result.shape) return { ok: false, error: `hole ${cmd.resultId}: countersink cut failed: ${result.error ?? 'no shape'}` };
    if (acc !== target) bridge.release(acc);
    acc = result.shape;
    warnings.push(...toolResult.warnings, ...result.warnings);
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
      case 'hole':
        res = await runHole(bridge, cmd, handles);
        break;
      case 'shell': {
        const target = handles.get(cmd.target);
        if (!target) { res = { ok: false, error: `shell ${cmd.resultId}: target ${cmd.target} not built` }; break; }
        if (!bridge.solidShell) { res = { ok: false, error: `shell ${cmd.resultId}: bridge has no solidShell` }; break; }
        const r = await bridge.solidShell(target, cmd.faceIds, cmd.thickness);
        res = r.ok && r.shape ? { ok: true, shape: r.shape, warnings: r.warnings } : { ok: false, error: `shell ${cmd.resultId}: ${r.error ?? 'no shape'}` };
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
