export interface CadCorpusCandidateEvidenceScore { score: number; reasons: string[] }

/** Lightweight discovery score only. It selects a candidate; it never grants evidence pass. */
export function scoreCadCorpusCandidateEvidence(extension: string, source: string, assertions: readonly string[]): CadCorpusCandidateEvidenceScore {
  if (extension !== 'step' && extension !== 'stp') return { score: 0, reasons: [] };
  const requested = new Set(assertions), reasons: string[] = [];
  const edges = [...source.matchAll(/NEXT_ASSEMBLY_USAGE_OCCURRENCE\s*\([^;]*?#(\d+)\s*,\s*#(\d+)\s*,\s*\$\s*\)/gi)].map(match => ({ parent: match[1]!, child: match[2]! }));
  const parents = new Set(edges.map(edge => edge.parent)), children = new Set(edges.map(edge => edge.child));
  let score = 0;
  if ((requested.has('assembly_hierarchy') || requested.has('subassemblies')) && edges.length) { score += Math.min(40, 10 + edges.length); reasons.push(`nauo:${edges.length}`); }
  if (requested.has('subassemblies')) { const nested = [...parents].filter(id => children.has(id)).length; if (nested) { score += 80 + nested; reasons.push(`nested_definition:${nested}`); } }
  if (requested.has('shaft_bearing_layout')) {
    const shaft = /shaft|spindle|axle/i.test(source), bearing = /bearing|bushing|bush/i.test(source);
    if (shaft) { score += 25; reasons.push('shaft_name'); }
    if (bearing) { score += 25; reasons.push('bearing_name'); }
    if (shaft && bearing && /CYLINDRICAL_SURFACE\s*\(/i.test(source)) { score += 30; reasons.push('shaft_bearing_cylinders'); }
  }
  if (requested.has('pattern_fidelity')) {
    const frequencies = new Map<string, number>();
    for (const edge of edges) frequencies.set(edge.child, (frequencies.get(edge.child) ?? 0) + 1);
    const repeated = [...frequencies.values()].filter(count => count >= 3).length;
    if (repeated) { score += 10 + repeated; reasons.push(`repeated_definitions:${repeated}`); }
  }
  return { score, reasons };
}
