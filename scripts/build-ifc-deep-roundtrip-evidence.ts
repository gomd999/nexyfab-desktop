import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BIM_REGISTRY_SCHEMA, type BimInformationInstance, type BimInformationRegistry } from '../src/lib/bim/informationRegistry';
import { verifyIfcDeepSemanticRoundtrip } from '../src/lib/bim/ifcDeepSemanticRoundtrip';
import { validateIfcRegistryBinding } from '../src/lib/bim/ifcRegistryBinding';
import { ifcToNexyfabAssembly } from '../src/lib/brep-bridge/ifcImport';
import { pseudoGuid, selfCheckIfc, writeIfcText } from '../src/lib/brep-bridge/ifcExport';
import type { PolyMesh } from '../src/lib/brep-bridge/satExport';

const mesh: PolyMesh = {
  verts: [[0, 0, 0], [20, 0, 0], [20, 30, 0], [0, 30, 0], [0, 0, 40], [20, 0, 40], [20, 30, 40], [0, 30, 40]],
  faces: [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]],
};
const registry: BimInformationRegistry = {
  schema: BIM_REGISTRY_SCHEMA, registryId: 'nexyfab-ifc-proof', version: '1',
  sourceReferences: [{ id: 'proof', path: 'internal:ifc-deep-roundtrip-proof', revision: '1', access: 'read_only' }],
  units: [{ code: 'none', symbol: '-', dimension: 'none' }, { code: 'm', symbol: 'm', dimension: 'length' }],
  classifications: [{ scheme: 'WBS', code: 'A1', name: 'Earthwork', level: 5, sourceRef: 'proof' }],
  properties: [
    { pset: 'Pset_Element', key: 'Status', name: 'Status', type: 'string', unit: 'none', requiredAt: ['design'], sourceRef: 'proof' },
    { pset: 'Pset_Element', key: 'Length', name: 'Length', type: 'number', unit: 'm', requiredAt: ['design'], sourceRef: 'proof' },
  ],
  bepRequirements: [{ key: 'qualityPlan', type: 'object', requiredAt: ['design'], sourceRef: 'proof' }],
};
const instance: BimInformationInstance = {
  registryId: registry.registryId, registryVersion: registry.version, stage: 'design', classifications: [{ scheme: 'WBS', code: 'A1' }],
  properties: [
    { pset: 'Pset_Element', key: 'Status', value: 'Approved', unit: 'none', source: 'user', sourceRef: 'approval:proof' },
    { pset: 'Pset_Element', key: 'Length', value: 5, unit: 'm', source: 'derived', sourceRef: 'dimension:proof' },
  ],
  bep: { qualityPlan: { reviewer: 'proof-reviewer' } },
};

async function main(): Promise<void> {
  const output = path.resolve(process.argv[2] ?? 'docs/evidence/bim-guideline/ifc-deep-roundtrip-260810.json');
  const exported = writeIfcText(mesh, {
    name: 'ifc-deep-proof',
    bim: {
      instance,
      quantities: [{ setName: 'BaseQuantities', name: 'NetVolume', type: 'volume', value: 0.000024, unit: 'm3' }],
      projectedCrs: { name: 'EPSG:5186', eastings: 200000, northings: 450000, orthogonalHeight: 0, xAxisAbscissa: 1, xAxisOrdinate: 0, scale: 1 },
    },
  });
  if (!exported.ok) throw new Error(exported.error);
  const structural = selfCheckIfc(exported.text, { brepPoints: 8 });
  const roundtrip = verifyIfcDeepSemanticRoundtrip(exported.text, exported.text);
  const proxyGuid = pseudoGuid('nexyfab-w5h:ifc-deep-proof:proxy');
  const binding = validateIfcRegistryBinding(registry, instance, exported.text, proxyGuid);
  const imported = ifcToNexyfabAssembly(exported.text, { name: 'ifc-deep-proof-import' });
  const mutation = verifyIfcDeepSemanticRoundtrip(exported.text, exported.text.replace("IFCLABEL('Approved')", "IFCLABEL('Draft')"));
  const releaseReady = structural.ok && roundtrip.passed && binding.passed && imported.ok === true && imported.assembly?.parts[0]?.geometryEvidence === 'exact_surface_mesh' && mutation.passed === false && mutation.errors.includes('PROPERTY_SET_CHANGED');
  const evidence = {
    schema: 'nexyfab.ifc-deep-roundtrip-evidence.v1', generatedAt: new Date().toISOString(), releaseReady,
    sourcePolicy: { generatedIfcPersisted: false, sourceReturned: false, sideEffects: false },
    export: { schema: 'IFC4', bytes: Buffer.byteLength(exported.text), sha256: createHash('sha256').update(exported.text).digest('hex'), stats: exported.stats },
    structural,
    semantics: {
      passed: roundtrip.passed, errors: roundtrip.errors,
      counts: {
        occurrences: roundtrip.before.occurrences.length, placements: roundtrip.before.placements.length,
        propertySets: roundtrip.before.propertySets.length, propertyValues: roundtrip.before.propertySets.reduce((sum, pset) => sum + pset.values.length, 0),
        classifications: roundtrip.before.classifications.length, quantities: roundtrip.before.quantities.length, georeference: roundtrip.before.georeference.length,
      },
    },
    registryBinding: { passed: binding.passed, issues: binding.issues, registryId: binding.registryId, registryVersion: binding.registryVersion },
    geometryReimport: { ok: imported.ok, imported: imported.stats?.imported ?? 0, geometryEvidence: imported.assembly?.parts[0]?.geometryEvidence ?? null },
    negativeControl: { passed: !mutation.passed && mutation.errors.includes('PROPERTY_SET_CHANGED'), detectedErrors: mutation.errors },
  };
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ output: path.relative(process.cwd(), output), releaseReady, counts: evidence.semantics.counts })}\n`);
  if (!releaseReady) process.exitCode = 1;
}

void main();
