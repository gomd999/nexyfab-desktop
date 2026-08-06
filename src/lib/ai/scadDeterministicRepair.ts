export interface ScadRepairMutation {
  code: string;
  boundary: 'definition:wheel' | 'occurrence:window' | 'assembly:gear-support' | 'assembly:pipe-junction';
  beforeCount: number;
  afterCount: number;
}

export interface ScadRepairResult {
  status: 'repaired' | 'not_run';
  source: string;
  mutations: ScadRepairMutation[];
  unresolvedCodes: string[];
}

function replaceExactly(source: string, pattern: RegExp, replacement: string, code: string, boundary: ScadRepairMutation['boundary']) {
  const matches = source.match(pattern)?.length ?? 0;
  if (matches !== 1) return { source, mutation: null, unresolved: `${code}:EXPECTED_ONE_MATCH_FOUND_${matches}` };
  const next = source.replace(pattern, replacement);
  return { source: next, mutation: { code, boundary, beforeCount: matches, afterCount: next.match(pattern)?.length ?? 0 }, unresolved: null };
}

export function repairScadScenario(scenarioId: string, source: string, codes: readonly string[]): ScadRepairResult {
  let current = source;
  const mutations: ScadRepairMutation[] = [];
  const unresolvedCodes: string[] = [];
  const requested = new Set(codes);

  if (scenarioId === 'sc9_simple_car' && requested.has('CAR_WHEEL_AXIS_MISMATCH')) {
    const result = replaceExactly(current, /rotate\(\[0\s*,\s*90\s*,\s*0\]\)\s*cylinder/, 'rotate([90,0,0]) cylinder', 'CAR_WHEEL_AXIS_MISMATCH', 'definition:wheel');
    current = result.source; if (result.mutation) mutations.push(result.mutation); if (result.unresolved) unresolvedCodes.push(result.unresolved);
  }
  if (scenarioId === 'sc9_simple_car' && requested.has('CAR_DUPLICATE_WINDOW_OCCURRENCE')) {
    const lines = current.split(/\r?\n/), seen = new Set<string>(); let removed = 0;
    const next = lines.filter(line => {
      if (!/\bwindow\s*\(\s*\)\s*;/.test(line)) return true;
      const normalized = line.replace(/\s+/g, ' ').trim();
      if (seen.has(normalized)) { removed++; return false; }
      seen.add(normalized); return true;
    }).join('\n');
    if (removed === 1) { mutations.push({ code: 'CAR_DUPLICATE_WINDOW_OCCURRENCE', boundary: 'occurrence:window', beforeCount: 2, afterCount: 1 }); current = next; }
    else unresolvedCodes.push(`CAR_DUPLICATE_WINDOW_OCCURRENCE:EXPECTED_ONE_DUPLICATE_FOUND_${removed}`);
  }
  if (scenarioId === 'sc7_gear_train' && requested.has('GEAR_SUPPORT_JOINTS_NOT_MODELED')) {
    if (/module\s+(?:gear_base|shaft20|shaft30)\s*\(/.test(current)) unresolvedCodes.push('GEAR_SUPPORT_JOINTS_NOT_MODELED:SUPPORT_ALREADY_PARTIAL');
    else {
      const marker = current.match(/^\/\/.*composition.*$/mi)?.[0];
      if (!marker) unresolvedCodes.push('GEAR_SUPPORT_JOINTS_NOT_MODELED:COMPOSITION_MARKER_MISSING');
      else {
        const definitions = [
          'module gear_base() { cube([90,50,4], center=true); }',
          'module shaft20() { cylinder(d=7.8, h=16, center=true, $fn=64); }',
          'module shaft30() { cylinder(d=7.8, h=16, center=true, $fn=64); }',
        ].map((body, index) => `// ── module: ${['gear_base', 'shaft20', 'shaft30'][index]} ──\n${body}\n`).join('\n');
        current = current.replace(marker, `${definitions}\n${marker}`);
        current += '\ntranslate([25,0,-10]) gear_base();\nshaft20();\ntranslate([50,0,0]) shaft30();';
        mutations.push({ code: 'GEAR_SUPPORT_JOINTS_NOT_MODELED', boundary: 'assembly:gear-support', beforeCount: 0, afterCount: 3 });
      }
    }
  }
  if (scenarioId === 'sc8_pipe_joint' && requested.has('PIPE_FLOW_PATH_BLOCKED')) {
    const sourceHeight = (current.match(/h\s*=\s*50\b/g)?.length ?? 0) === 4 ? 50 : (current.match(/h\s*=\s*40\b/g)?.length ?? 0) === 4 ? 40 : null;
    const rightPattern = sourceHeight === 50
      ? /^rotate\(\[0,\s*90,\s*0\]\)\s*main_pipe_right\(\);$/m
      : /^translate\(\[10,\s*0,\s*0\]\)\s*rotate\(\[0,\s*90,\s*0\]\)\s*main_pipe_right\(\);$/m;
    const rightMatches = current.match(rightPattern)?.length ?? 0;
    if (sourceHeight === null || rightMatches !== 1) unresolvedCodes.push(`PIPE_FLOW_PATH_BLOCKED:EXPECTED_SUPPORTED_HEIGHT_RIGHT_FOUND_${sourceHeight ?? 'none'}_${rightMatches}`);
    else {
      current = current.replace(new RegExp(`h\\s*=\\s*${sourceHeight}\\b`, 'g'), 'h=45').replace(rightPattern, 'translate([5, 0, 0]) rotate([0, 90, 0]) main_pipe_right();');
      mutations.push({ code: 'PIPE_FLOW_PATH_BLOCKED', boundary: 'assembly:pipe-junction', beforeCount: 1, afterCount: 1 });
    }
  }
  for (const code of codes) if (!mutations.some(item => item.code === code) && !unresolvedCodes.some(item => item.startsWith(code))) unresolvedCodes.push(`${code}:NO_REGISTERED_REPAIR`);
  return { status: mutations.length > 0 && unresolvedCodes.length === 0 ? 'repaired' : 'not_run', source: current, mutations, unresolvedCodes };
}
