import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { TopologyGrid } from '../src/app/[lang]/shape-generator/analysis/topology3D';
import { computePreload, validateBoltPreload } from '../src/app/[lang]/shape-generator/fea/contactPreloadSetter';
import { solveMultiBodyContactFea } from '../src/app/[lang]/shape-generator/fea/multiBodyContactFea';

const output = resolve(process.argv[2] ?? 'docs/evidence/fea/multibody-contact-260810.json');
const sha = (value: string) => createHash('sha256').update(value).digest('hex');

async function main(): Promise<void> {
  const gridA = new TopologyGrid(1, 1, 1), gridB = new TopologyGrid(1, 1, 1);
  const interfaceA = [gridA.node(0, 0, 0), gridA.node(1, 0, 0), gridA.node(1, 1, 0), gridA.node(0, 1, 0)];
  const interfaceB = [gridB.node(0, 0, 0), gridB.node(1, 0, 0), gridB.node(1, 1, 0), gridB.node(0, 1, 0)];
  const loaded = [gridA.node(0, 0, 1), gridA.node(1, 0, 1), gridA.node(1, 1, 1), gridA.node(0, 1, 1)];
  const bolt = { kind: 'bolt' as const, threadDiameterMm: 10, propertyClass: '8.8', proofFraction: 0.7 };
  const preload = computePreload(bolt), preloadCheck = validateBoltPreload(bolt);
  const result = solveMultiBodyContactFea({
    bodies: [
      { id: 'plate-a', grid: gridA, youngsModulusMpa: 210000, poissonRatio: 0.3, cellMm: 10 },
      { id: 'plate-b', grid: gridB, youngsModulusMpa: 210000, poissonRatio: 0.3, cellMm: 10 },
    ],
    fixed: [
      ...interfaceB.map(nodeId => ({ bodyId: 'plate-b', nodeId, axes: [0, 1, 2] as Array<0 | 1 | 2> })),
      ...interfaceA.map(nodeId => ({ bodyId: 'plate-a', nodeId, axes: [0, 1] as Array<0 | 1 | 2> })),
    ],
    loads: loaded.map(nodeId => ({ bodyId: 'plate-a', nodeId, forceN: [0, 0, 250] as [number, number, number] })),
    contacts: interfaceA.map((nodeA, index) => ({
      id: `patch-node-${index}`, bodyA: 'plate-a', nodeA, bodyB: 'plate-b', nodeB: interfaceB[index]!, normalAxis: 2 as const,
      initialGapMm: 0, penaltyStiffnessNPerMm: 1e8,
    })),
    preloads: interfaceA.map((nodeA, index) => ({
      id: `m10-preload-${index}`, bodyA: 'plate-a', nodeA, bodyB: 'plate-b', nodeB: interfaceB[index]!, axis: 2 as const,
      forceN: preload.preloadN / interfaceA.length,
    })),
  });
  const body = {
    schema: 'nexyfab.multibody-contact-fea-run.v1',
    generatedAt: new Date().toISOString(),
    fixture: {
      purpose: 'deterministic solver integration; not an independent product holdout',
      bodies: 2, elements: 2, dof: result.displacement.length, contactNodes: result.contacts.length,
      material: { youngsModulusMpa: 210000, poissonRatio: 0.3 }, externalLoadN: 1000,
      bolt: { designation: 'M10-8.8', preloadN: preload.preloadN, proofLoadN: preloadCheck.maxAllowableN, withinProof: preloadCheck.withinLimit },
    },
    result: {
      converged: result.converged, linearConverged: result.linearConverged, activeSetConverged: result.activeSetConverged,
      nonlinearIterations: result.nonlinearIterations, linearIterations: result.linearIterations,
      equilibriumResidualRatio: result.equilibriumResidualRatio,
      maxDisplacementMm: result.maxDisplacementMm, maxVonMisesMpa: result.maxVonMisesMpa,
      activeContactCount: result.contacts.filter(item => item.active).length,
      resultantNormalForceN: result.contacts.reduce((sum, item) => sum + item.normalForceN, 0),
      preloadCount: result.preloads.length,
    },
    limitations: [
      'Structured HEX8, small-strain linear elasticity and frictionless normal penalty contact.',
      'B-Rep face/persistent-ID binding is verified by nexyfab.contact-fea-evidence.v1 but this deterministic fixture is not an external OCCT product holdout.',
      'Certification and independent reviewer approval remain WP9 not_run.',
    ],
  };
  const evidence = { ...body, evidenceSha256: sha(JSON.stringify(body)) };
  if (!result.converged || result.equilibriumResidualRatio > 1e-7 || result.contacts.some(item => !item.active)) throw new Error('MULTIBODY_CONTACT_FEA_EVIDENCE_GATE_FAILED');
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  process.stdout.write(`${output}\n`);
}

void main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
