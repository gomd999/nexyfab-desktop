import fs from 'node:fs';
import path from 'node:path';
import { ensureReplicad } from './drawing-to-3d/to-step.mjs';

const [bridgeArg, canonicalArg, outputArg] = process.argv.slice(2);
if (!bridgeArg || !canonicalArg || !outputArg) throw new Error('usage: tsx scripts/build-scad-native-flow-evidence.mjs <bridge.json> <canonical.json> <output.json>');
const read = file => JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
const bridge = read(bridgeArg), canonical = read(canonicalArg), rc = await ensureReplicad();
const canonicalByScenario = new Map(canonical.scenarios.map(item => [item.scenarioId, item.definitions]));
const results = [];

for (const assembly of bridge.assemblies) {
  if (assembly.scenarioId !== 'sc8_pipe_joint') continue;
  const architecture = assembly.bridge.architecture;
  const programs = new Map((canonicalByScenario.get(assembly.scenarioId) ?? []).map(item => [item.definitionId, item]));
  const transforms = new Map(assembly.bridge.transforms.map(item => [item.occurrenceId, item.matrix]));
  const voids = [], walls = [], codes = [];
  for (const occurrence of architecture.occurrences.filter(item => programs.has(item.definitionId))) {
    const root = programs.get(occurrence.definitionId)?.root, matrix = transforms.get(occurrence.id);
    if (root?.op !== 'subtract' || root.children[0]?.op !== 'cylinder' || root.children[1]?.op !== 'cylinder' || !matrix) { codes.push(`PIPE_NATIVE_PROFILE_UNSUPPORTED:${occurrence.id}`); continue; }
    const outerNode = root.children[0], innerNode = root.children[1];
    const location = [matrix[3], matrix[7], matrix[11]], direction = [matrix[2], matrix[6], matrix[10]];
    const outer = rc.makeCylinder(outerNode.diameter / 2, outerNode.height, location, direction);
    const inner = rc.makeCylinder(innerNode.diameter / 2, innerNode.height, location, direction);
    voids.push(inner); walls.push(outer.cut(inner));
  }
  if (voids.length !== 3 || walls.length !== 3 || codes.length) {
    results.push({ scenarioId: assembly.scenarioId, status: 'not_run', connectedComponentCount: null, blockedJunctionCount: null, flowVolumeMm3: null, codes: codes.length ? codes : ['PIPE_NATIVE_SECTIONS_MISSING'] });
    continue;
  }
  try {
    const intendedFlow = voids.slice(1).reduce((shape, item) => shape.fuse(item), voids[0]);
    const solidWalls = walls.slice(1).reduce((shape, item) => shape.fuse(item), walls[0]);
    const availableFlow = intendedFlow.cut(solidWalls);
    const connectedComponentCount = availableFlow._listTopo('solid').length;
    const flowVolumeMm3 = rc.measureVolume(availableFlow.asShape3D());
    const blockedJunctionCount = Math.max(0, connectedComponentCount - 1);
    const status = connectedComponentCount === 1 && flowVolumeMm3 > 0 ? 'pass' : 'fail';
    results.push({ scenarioId: assembly.scenarioId, status, connectedComponentCount, blockedJunctionCount, flowVolumeMm3, codes: status === 'pass' ? [] : ['PIPE_FLOW_PATH_BLOCKED'] });
  } catch (error) {
    results.push({ scenarioId: assembly.scenarioId, status: 'not_run', connectedComponentCount: null, blockedJunctionCount: null, flowVolumeMm3: null, codes: [`PIPE_NATIVE_BOOLEAN_FAILED:${error instanceof Error ? error.message : String(error)}`] });
  }
}
const artifact = { schema: 'nexyfab.scad-native-flow-evidence.v1', generatedAt: new Date().toISOString(), results };
const output = path.resolve(outputArg); fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(JSON.stringify(results));
if (results.some(item => item.status === 'fail')) process.exitCode = 1;
