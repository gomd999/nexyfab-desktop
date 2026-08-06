#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || 'C:/Users/gomd9/Downloads/참고파일들');
const outputArg = process.argv.find(arg => arg.startsWith('--output='));
const output = outputArg ? path.resolve(outputArg.slice(9)) : null;
const excluded = p => {
  const n = `/${p.replaceAll('\\', '/').toLowerCase()}/`;
  return n.includes('/result/') || n.includes('/.gate_work/') || n.includes('/.git/') ||
    n.endsWith('/.env/') || n.includes('/node_modules/');
};
const executable = new Set(['.step', '.stp', '.stl', '.dxf', '.ifc', '.scad']);
const referenceOnly = new Set(['.sldprt', '.sldasm', '.slddrw', '.ipt', '.iam', '.catpart', '.catproduct', '.dwg', '.rvt', '.pdf']);

if (!existsSync(root)) throw new Error(`Corpus root does not exist: ${root}`);
const files = [];
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const relative = path.relative(root, full);
    if (excluded(relative)) continue;
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile()) files.push({ full, relative, sizeBytes: statSync(full).size });
  }
}
walk(root);

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

const extensions = {};
const support = { executable: 0, reference_only: 0, unsupported: 0 };
const hashes = new Map();
for (const file of files) {
  const ext = path.extname(file.relative).toLowerCase();
  extensions[ext || '(none)'] = (extensions[ext || '(none)'] || 0) + 1;
  const status = executable.has(ext) ? 'executable' : referenceOnly.has(ext) ? 'reference_only' : 'unsupported';
  support[status]++;
  const digest = await sha256(file.full);
  const group = hashes.get(digest) || [];
  group.push(file.relative);
  hashes.set(digest, group);
}
const duplicates = [...hashes.entries()].filter(([, names]) => names.length > 1).map(([sha256, names]) => ({ sha256, count: names.length, paths: names }));
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  rootLabel: path.basename(root),
  policy: { sourceReadOnly: true, copiedCadBytes: false, secretsExcluded: true, redistributionAllowed: false },
  counts: { files: files.length, uniqueContent: hashes.size, duplicateGroups: duplicates.length, support },
  extensions: Object.fromEntries(Object.entries(extensions).sort((a, b) => b[1] - a[1])),
  duplicates,
};
const json = JSON.stringify(report, null, 2);
if (output) writeFileSync(output, json);
else process.stdout.write(`${json}\n`);

