#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const arg = name => process.argv.find(item => item.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = path.resolve(arg('root') || 'C:/Users/gomd9/Downloads/참고파일들');
const inventoryPath = path.resolve(arg('inventory') || path.join(root, 'result', 'inventory.json'));
const output = path.resolve(arg('output') || 'C:/tmp/nexyfab-complex-candidates.json');
const RULES = [
  ['robot', /robot|robotic|mearm|manipulator|servo/i],
  ['gearbox', /gear|gearbox|differential|transmission|bearing|reducer/i],
  ['pressure_vessel', /pressure.?vessel|tank|boiler|heat.?exchanger|shell.?tube/i],
  ['turbomachinery', /jet|turbine|compressor|impeller|fan|nozzle/i],
  ['factory_equipment', /factory|conveyor|loader|excavator|machine|stair|frame|rack/i],
  ['interior', /interior|building|architecture|house|room|door|window|furniture|ifc/i],
];
const safeRelative = value => { const normalized = String(value).replaceAll('\\', '/'); if (!normalized || normalized.startsWith('/') || /^[a-z]:/i.test(normalized) || normalized.split('/').includes('..')) throw new Error('unsafe inventory path'); return normalized; };
const inventory = JSON.parse(await readFile(inventoryPath, 'utf8'));
const selected = [];
for (const item of inventory.files ?? []) {
  const relativePath = safeRelative(item.path), extension = path.extname(relativePath).toLowerCase();
  if (!['.step', '.stp', '.ifc'].includes(extension) || relativePath.toLowerCase().includes('/result/')) continue;
  const match = RULES.find(([, pattern]) => pattern.test(relativePath)); if (!match) continue;
  const bytes = await readFile(path.resolve(root, relativePath));
  selected.push({ family: match[0], relativePath, sourceHash: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.byteLength, extension: extension.slice(1) });
}
const byHash = new Map();
for (const item of selected.sort((a, b) => a.relativePath.localeCompare(b.relativePath))) {
  const prior = byHash.get(item.sourceHash);
  if (prior) { prior.duplicateLocators.push(item.relativePath); continue; }
  byHash.set(item.sourceHash, { schema: 'nexyfab.complex-candidate.v1', status: 'candidate_unreviewed', family: item.family, sourceHash: item.sourceHash, bytes: item.bytes, extension: item.extension, localLocator: item.relativePath, duplicateLocators: [], split: 'unassigned', groundTruthApproved: false });
}
const candidates = [...byHash.values()];
const counts = Object.fromEntries(RULES.map(([family]) => [family, candidates.filter(item => item.family === family).length]));
await writeFile(output, `${JSON.stringify({ schema: 'nexyfab.complex-candidate-manifest.v1', generatedAt: new Date().toISOString(), policy: { localOnly: true, sourceBytesCopied: false, scoreEligible: false, requiresGroundTruthApproval: true }, counts, candidates }, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ output, discovered: selected.length, unique: candidates.length, duplicates: selected.length - candidates.length, counts })}\n`);
