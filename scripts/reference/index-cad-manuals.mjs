#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const rootArg = process.argv[2] || process.env.NEXYFAB_CAD_MANUALS_ROOT;
if (!rootArg) throw new Error('Manuals root is required as the first argument or NEXYFAB_CAD_MANUALS_ROOT.');
const root = path.resolve(rootArg);
const outputArg = process.argv.find(arg => arg.startsWith('--output='));
const output = path.resolve(outputArg?.slice(9) || 'docs/cad-program/requirements/manual-index.json');
const families = [
  ['solidworks', ['solidworks']], ['fusion360', ['fusion']], ['rhino', ['rhino']],
  ['grasshopper', ['grasshopper']], ['civil3d', ['civil 3d', 'civil']], ['autocad', ['autocad']],
  ['vectorworks', ['vectorworks']], ['microstation', ['microstation']], ['sketchup', ['sketchup']],
  ['visualization', ['3ds max', 'enscape']],
];
// A few supplied filenames are generic or misleading. Bind their reviewed
// classification to immutable source bytes instead of guessing from names.
const knownClassificationBySha256 = Object.freeze({
  '878d1c9a5afd238b772df1874734dcbd561909b4ccbd24019c58941f31f41e02': Object.freeze({ family: 'midas-civil', domains: ['civil', 'bridge', 'structural_analysis', 'fea'] }),
  '0dedbe46507cdafddd30f1efa31aa4c49ee89cfd4746188f13d8947c3f6b190e': Object.freeze({ family: 'visualization', domains: ['architecture', 'interior', 'visualization'] }),
  'a0b8f612ba00b7a40ca91eb4c3b66496c5b4deb1915fb0c76e02266d0b7c104b': Object.freeze({ family: 'solidworks', domains: ['part', 'assembly', 'drawing', 'manufacturing', 'pdm'] }),
  'aea891e73964c4976e2c3f8f224493794de6e886e0bd4f0d0d879217ef406200': Object.freeze({ family: 'grasshopper', domains: ['parametric_graph', 'surface', 'brep'] }),
});
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
  const digest = createHash('sha256').update(bytes).digest('hex');
  const low = entry.name.toLowerCase();
  const known = knownClassificationBySha256[digest];
  const family = known?.family ?? families.find(([, terms]) => terms.some(term => low.includes(term)))?.[0] ?? 'other';
  return {
    documentId: `MANUAL-${String(index + 1).padStart(2, '0')}`,
    fileName: entry.name,
    sha256: digest,
    bytes: statSync(full).size,
    pageCount: approximatePdfPages(bytes),
    pageCountMethod: 'pdf-page-object-scan-approximate',
    family,
    domains: known?.domains ?? domainsByFamily[family] ?? ['review_required'],
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
