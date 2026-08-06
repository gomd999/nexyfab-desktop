import type { OcctBridge } from '@/lib/occt/bridge'; import type { OcctShape } from '@/lib/occt/types';
export interface ServiceOpeningCutEvidence { status: 'passed' | 'failed' | 'not_run'; resultShape?: OcctShape; removedVolumeMm3?: number; before?: { valid: boolean; solidCount: number }; after?: { valid: boolean; solidCount: number }; errors: string[]; method: 'occt_boolean_subtract' }
export async function executeServiceOpeningBrepCuts(bridge: OcctBridge, hostId: string, host: OcctShape, tools: Array<{ openingId: string; shape: OcctShape }>, authoritativeKernel: boolean): Promise<ServiceOpeningCutEvidence> {
  if (!authoritativeKernel || !bridge.inspectShape) return { status: 'not_run', errors: ['Authoritative OCCT inspection is unavailable.'], method: 'occt_boolean_subtract' };
  if (!tools.length) return { status: 'not_run', errors: ['No service opening cut tools were supplied.'], method: 'occt_boolean_subtract' };
  const before = await bridge.inspectShape(host); if (!before.valid || before.solidCount < 1) return { status: 'failed', before, errors: ['Host B-Rep is invalid or has no solid.'], method: 'occt_boolean_subtract' };
  let current = host;
  for (const tool of tools) { const cut = await bridge.boolean.subtract(current, tool.shape, { baseId: hostId, toolId: tool.openingId, opId: `service-cut:${tool.openingId}` }); if (!cut.ok || !cut.shape) return { status: 'failed', before, errors: [cut.error ?? `${tool.openingId}: boolean returned no shape.`], method: 'occt_boolean_subtract' }; current = cut.shape; }
  const after = await bridge.inspectShape(current), removedVolumeMm3 = (host.volume ?? Number.NaN) - (current.volume ?? Number.NaN); const errors = [...(!after.valid || after.solidCount < 1 ? ['Cut result is invalid or has no solid.'] : []), ...(!Number.isFinite(removedVolumeMm3) || removedVolumeMm3 <= 0 ? ['Exact positive removed volume was not measured.'] : [])];
  return { status: errors.length ? 'failed' : 'passed', resultShape: current, removedVolumeMm3, before, after, errors, method: 'occt_boolean_subtract' };
}
