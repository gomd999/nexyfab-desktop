#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || 'C:/Users/gomd9/Downloads/nexysys_1/nexyfab.com/document(manuals)');
const outputArg = process.argv.find(arg => arg.startsWith('--output='));
const output = path.resolve(outputArg?.slice(9) || 'docs/cad-program/requirements/manual-index.json');
const families = [
  ['solidworks', ['solidworks']], ['fusion360', ['fusion']], ['rhino', ['rhino']],
  ['grasshopper', ['grasshopper']], ['civil3d', ['civil 3d', 'civil']], ['autocad', ['autocad']],
  ['vectorworks', ['vectorworks']], ['microstation', ['microstation']], ['sketchup', ['sketchup']],
  ['visualization', ['3ds max', 'enscape']],
];
const domainsByFamily = {
  solidworks: ['part', 'assembly', 'drawing', 'manufacturing'],
  fusion360: ['part', 'assembly', 'manufacturing'],
  rhino: ['surface', 'brep', 'drafting'], grasshopper: ['parametric_graph'],
  civil3d: ['civil', 'alignment', 'survey'], autocad: ['drafting', 'drawing'],
  vectorworks: ['bim', 'landscape', 'drawing'], microstation: ['civil', 'drawing'],
  sketchup: ['concept_modeling'], visualization: ['visualization'],
};
function approximatePdfPages(bytes) {
  const text = bytes.toString('latin1');
  const matches = text.match(/\/Type\s*\/Page\b/g);
  return matches?.length || null;
}
const files = readdirSync(root, { withFileTypes: true }).filter(e => e.isFile() && e.name.toLowerCase().endsWith('.pdf'));
const documents = files.sort((a, b) => a.name.localeCompare(b.name)).map((entry, index) => {
  const full = path.join(root, entry.name);
  const bytes = readFileSync(full);
  const low = entry.name.toLowerCase();
  const family = families.find(([, terms]) => terms.some(term => low.includes(term)))?.[0] || 'other';
  return {
    documentId: `MANUAL-${String(index + 1).padStart(2, '0')}`,
    fileName: entry.name,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: statSync(full).size,
    pageCount: approximatePdfPages(bytes),
    pageCountMethod: 'pdf-page-object-scan-approximate',
    family,
    domains: domainsByFamily[family] || ['review_required'],
    sourcePolicy: 'read_only_local_reference',
  };
});
const payload = {
  schemaVersion: 1, generatedAt: new Date().toISOString(), rootLabel: path.basename(root),
  policy: { sourceReadOnly: true, copiedPdfBytes: false, promptBulkIngestion: false },
  count: documents.length, documents,
};
writeFileSync(output, JSON.stringify(payload, null, 2));
process.stdout.write(`indexed ${documents.length} manuals -> ${output}\n`);

