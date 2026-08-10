export interface ReferenceGuidance {
  requirementIds: string[];
  rules: string[];
}

const GUIDANCE = {
  common: [
    ['NX-REQ-001', 'Give every requirement a sourceRef and allocate it to at least one editable component definition.'],
    ['NX-AUTH-001', 'Do not enter exact geometry while material, process, catalog identity, critical dimensions, or acceptance criteria remain assumed.'],
    ['NX-COORD-001', 'Preserve explicit units, coordinate-system identity, datum and placement provenance.'],
    ['NX-AUDIT-001', 'Record measured value, limit, object path, source and revision for every release gate.'],
  ],
  mechanical: [
    ['MAN-FT-001', 'Preserve an ordered editable feature tree; do not replace manufactured parts with opaque meshes.'],
    ['MAN-ASM-002', 'Preserve independent definitions, occurrences, hierarchy, and transforms.'],
    ['MAN-IO-001', 'Require assembly STEP roundtrip without hierarchy flattening.'],
    ['MAN-HEAL-001', 'Accept healing only after validity, solid, volume, topology, minimum-edge, and tolerance-growth checks.'],
    ['NX-CONN-001', 'Every movable occurrence must have an active mate path to a fixed root before assembly solving.'],
  ],
  robot: [
    ['MAN-ASM-001', 'Define mates, residual tolerance, and accepted remaining degrees of freedom.'],
    ['MAN-CCD-001', 'Verify continuous motion collision rather than sampled-frame collision only.'],
  ],
  pmi: [['MAN-PMI-001', 'Bind semantic dimensions and GD&T to persistent topology references.']],
  building: [
    ['MAN-BIM-001', 'Preserve IFC spatial hierarchy and placement chains without counting spaces as parts.'],
    ['MAN-BLD-001', 'Preserve storeys, grids, spaces, hosts, openings and schedules as semantic BIM objects.'],
  ],
  interior: [
    ['MAN-INT-001', 'Verify closed spaces, egress, dynamic door clearance, finishes, and MEP interference.'],
  ],
  sheet: [['MAN-SM-001', 'Require flat-pattern, bend, and DXF evidence for sheet-metal definitions.']],
  weldment: [['MAN-WL-001', 'Require member identity, miters, cut list, stock length, and mass evidence.']],
  surface: [['MAN-SURF-001', 'Use loft, sweep, NURBS, and stitched B-rep evidence; do not certify a display mesh as an exact surface.']],
  civil: [
    ['MAN-CIV-001', 'Treat corridor and alignment generation as unsupported until horizontal/vertical alignment sweep evidence exists.'],
    ['MAN-CIV-002', 'Preserve CRS, survey control, existing/proposed surfaces, stationing, profiles and drainage networks.'],
  ],
  landscape: [
    ['MAN-LAND-001', 'Preserve existing/proposed terrain, planting identity, mature clearance, soil volume, surface flow and irrigation evidence.'],
  ],
  gearbox: [
    ['NX-GEAR-001', 'Confirm ratio, torque, speed, backlash, center distances, bearing arrangement, shaft fits, lubrication, and service life before exact gear geometry.'],
    ['NX-GEAR-002', 'Keep gears, shafts, bearings, seals, fasteners, and housing as reusable definitions with explicit interfaces and BOM quantities.'],
  ],
  pressureVessel: [
    ['NX-PV-001', 'Require design pressure and temperature, code basis, material allowable, corrosion allowance, weld efficiency, nozzle loads, and test condition; never infer wall thickness.'],
  ],
  turbomachinery: [
    ['NX-TURBO-001', 'Require operating envelope, fluid, speed, direction, balance class, blade count, clearances, shaft/bearing interfaces, and material before certifying rotating geometry.'],
  ],
  factoryEquipment: [
    ['NX-FACT-001', 'Require payload, duty cycle, speed, drive sizing, support reactions, guarding, maintenance clearance, emergency-stop zones, and service access.'],
  ],
  parametricGraph: [['MAN-GRAPH-001', 'Do not claim an editable data-flow graph; preserve the ordered feature tree and mark graph editing unavailable.']],
} as const;

export function referenceGuidanceForRequest(request: string): ReferenceGuidance {
  const text = request.normalize('NFKC').toLowerCase();
  const selected: Array<readonly [string, string]> = [...GUIDANCE.common];
  const isCivil = /civil|토목|corridor|선형|alignment|road|도로|rail|철도|측량|survey/.test(text);
  const isLandscape = /landscape|조경|식재|planting|hardscape|관개|irrigation/.test(text);
  const isInterior = /interior|인테리어|가구|furniture|finish|마감|millwork|천장/.test(text);
  const isBuilding = /architecture|architectural|건축|building|건물|room|공간|ifc|bim|벽|wall|slab/.test(text);
  const isMechanical = /mechanical|기계|product|제품|part|부품|assembly|조립|robot|로봇|arm|manipulator|servo|motion|joint|gear|기어|shaft|축|bearing|베어링|conveyor|컨베이어|pressure.?vessel|압력.?용기|turbine|터빈|pump|펌프/.test(text);
  if (isMechanical) selected.push(...GUIDANCE.mechanical);
  if (isBuilding) selected.push(...GUIDANCE.building);
  if (isInterior) selected.push(...GUIDANCE.interior);
  if (isCivil) selected.push(...GUIDANCE.civil);
  if (isLandscape) selected.push(...GUIDANCE.landscape);
  if (/robot|로봇|arm|manipulator|servo|motion|joint/.test(text)) selected.push(...GUIDANCE.robot);
  if (/gdt|gd&t|pmi|공차|도면|drawing|tolerance/.test(text)) selected.push(...GUIDANCE.pmi);
  if (/sheet.?metal|판금|cabinet|enclosure/.test(text)) selected.push(...GUIDANCE.sheet);
  if (/weld|용접|frame|프레임|stair|계단/.test(text)) selected.push(...GUIDANCE.weldment);
  if (/surface|곡면|nurbs|loft|sweep|blade|블레이드|impeller|임펠러/.test(text)) selected.push(...GUIDANCE.surface);
  if (/gearbox|gear.?box|감속기|기어박스|planetary|worm.?gear|transmission/.test(text)) selected.push(...GUIDANCE.gearbox);
  if (/pressure.?vessel|압력.?용기|boiler|보일러|autoclave|receiver.?tank|heat.?exchanger/.test(text)) selected.push(...GUIDANCE.pressureVessel);
  if (/turbine|터빈|compressor|압축기|impeller|임펠러|pump|펌프|blower|프로펠러/.test(text)) selected.push(...GUIDANCE.turbomachinery);
  if (/conveyor|컨베이어|production.?line|생산.?라인|loader|크레인|packaging|palletizer|factory.?equipment/.test(text)) selected.push(...GUIDANCE.factoryEquipment);
  if (/grasshopper|node.?graph|data.?flow|파라메트릭.?그래프/.test(text)) selected.push(...GUIDANCE.parametricGraph);
  const unique = new Map(selected.map(item => [item[0], item[1]]));
  return { requirementIds: [...unique.keys()], rules: [...unique.values()] };
}
