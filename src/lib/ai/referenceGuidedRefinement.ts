export interface ReferenceGuidance {
  requirementIds: string[];
  rules: string[];
}

const GUIDANCE = {
  common: [
    ['MAN-FT-001', 'Preserve an ordered editable feature tree; do not replace manufactured parts with opaque meshes.'],
    ['MAN-ASM-002', 'Preserve independent definitions, occurrences, hierarchy, and transforms.'],
    ['MAN-IO-001', 'Require assembly STEP roundtrip without hierarchy flattening.'],
    ['MAN-HEAL-001', 'Accept healing only after validity, solid, volume, topology, minimum-edge, and tolerance-growth checks.'],
  ],
  robot: [
    ['MAN-ASM-001', 'Define mates, residual tolerance, and accepted remaining degrees of freedom.'],
    ['MAN-CCD-001', 'Verify continuous motion collision rather than sampled-frame collision only.'],
  ],
  pmi: [['MAN-PMI-001', 'Bind semantic dimensions and GD&T to persistent topology references.']],
  interior: [
    ['MAN-BIM-001', 'Preserve IFC spatial hierarchy and placement chains without counting spaces as parts.'],
    ['MAN-INT-001', 'Verify closed spaces, egress, dynamic door clearance, finishes, and MEP interference.'],
  ],
  sheet: [['MAN-SM-001', 'Require flat-pattern, bend, and DXF evidence for sheet-metal definitions.']],
  weldment: [['MAN-WL-001', 'Require member identity, miters, cut list, stock length, and mass evidence.']],
  surface: [['MAN-SURF-001', 'Use loft, sweep, NURBS, and stitched B-rep evidence; do not certify a display mesh as an exact surface.']],
  civil: [['MAN-CIV-001', 'Treat corridor and alignment generation as unsupported until horizontal/vertical alignment sweep evidence exists.']],
  parametricGraph: [['MAN-GRAPH-001', 'Do not claim an editable data-flow graph; preserve the ordered feature tree and mark graph editing unavailable.']],
} as const;

export function referenceGuidanceForRequest(request: string): ReferenceGuidance {
  const text = request.normalize('NFKC').toLowerCase();
  const selected: Array<readonly [string, string]> = [...GUIDANCE.common];
  if (/robot|로봇|arm|manipulator|servo|motion|joint/.test(text)) selected.push(...GUIDANCE.robot);
  if (/gdt|gd&t|pmi|공차|도면|drawing|tolerance/.test(text)) selected.push(...GUIDANCE.pmi);
  if (/interior|인테리어|building|건물|room|공간|ifc|bim|door|mep/.test(text)) selected.push(...GUIDANCE.interior);
  if (/sheet.?metal|판금|cabinet|enclosure/.test(text)) selected.push(...GUIDANCE.sheet);
  if (/weld|용접|frame|프레임|stair|계단/.test(text)) selected.push(...GUIDANCE.weldment);
  if (/surface|곡면|nurbs|loft|sweep|blade|블레이드|impeller|임펠러/.test(text)) selected.push(...GUIDANCE.surface);
  if (/civil|토목|corridor|선형|alignment|road|도로|rail|철도/.test(text)) selected.push(...GUIDANCE.civil);
  if (/grasshopper|node.?graph|data.?flow|파라메트릭.?그래프/.test(text)) selected.push(...GUIDANCE.parametricGraph);
  const unique = new Map(selected.map(item => [item[0], item[1]]));
  return { requirementIds: [...unique.keys()], rules: [...unique.values()] };
}
