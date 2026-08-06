#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const arg = name => process.argv.find(item => item.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = path.resolve(arg('root') || 'C:/Users/gomd9/Downloads/참고파일들');
const inventoryPath = path.resolve(arg('inventory') || path.join(root, 'result', 'inventory.json'));
const output = path.resolve(arg('output') || 'C:/tmp/nexyfab-ifc-spatial-candidates.json');
const count = (text, expression) => (text.match(expression) ?? []).length;
const inventory = JSON.parse(await readFile(inventoryPath, 'utf8')), records = [];
for (const item of inventory.files ?? []) {
  if (String(item.ext).toLowerCase() !== '.ifc') continue;
  const locator = String(item.path).replaceAll('\\', '/');
  if (!locator || locator.startsWith('/') || locator.split('/').includes('..') || locator.toLowerCase().includes('/result/')) continue;
  const bytes = await readFile(path.resolve(root, locator)), text = bytes.toString('latin1');
  const measured = { projects: count(text, /=\s*IFCPROJECT\s*\(/gi), buildings: count(text, /=\s*IFCBUILDING\s*\(/gi), storeys: count(text, /=\s*IFCBUILDINGSTOREY\s*\(/gi), spaces: count(text, /=\s*IFCSPACE\s*\(/gi), zones: count(text, /=\s*IFCSPATIALZONE\s*\(/gi), doors: count(text, /=\s*IFCDOOR\s*\(/gi), boundaries: count(text, /=\s*IFCRELSPACEBOUNDARY(?:1STLEVEL|2NDLEVEL)?\s*\(/gi), localPlacements: count(text, /=\s*IFCLOCALPLACEMENT\s*\(/gi), containment: count(text, /=\s*IFCRELCONTAINEDINSPATIALSTRUCTURE\s*\(/gi) };
  const sourceHash = createHash('sha256').update(bytes).digest('hex');
  records.push({ sourceHash, bytes: bytes.byteLength, localLocator: locator, schema: text.match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i)?.[1] ?? null, measured,
    buildingStructureCandidate: measured.projects > 0 && measured.buildings > 0 && measured.storeys > 0 && measured.localPlacements > 0,
    interiorSpatialCandidate: measured.projects > 0 && measured.buildings > 0 && measured.storeys > 0 && measured.spaces > 0 && measured.localPlacements > 0,
    egressCandidate: measured.spaces > 0 && measured.doors > 0,
    boundaryCandidate: measured.spaces > 0 && measured.boundaries > 0,
    groundTruthApproved: false, scoreEligible: false });
}
const summary = { totalIfc: records.length, buildingStructure: records.filter(item => item.buildingStructureCandidate).length, interiorSpatial: records.filter(item => item.interiorSpatialCandidate).length, egress: records.filter(item => item.egressCandidate).length, spaceBoundary: records.filter(item => item.boundaryCandidate).length };
await writeFile(output, `${JSON.stringify({ schema: 'nexyfab.ifc-spatial-candidates.v1', generatedAt: new Date().toISOString(), policy: { localOnly: true, rawSha256: true, regexEvidenceCandidateOnly: true, scoreEligible: false }, summary, records }, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ output, ...summary })}\n`);
