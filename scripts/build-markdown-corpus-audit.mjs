#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const output = path.resolve(cwd, 'docs/evidence/documentation/markdown-corpus-audit-260810.json');
const markerPatterns = {
  todo: /\bTODO\b/gi,
  notRun: /\bnot_run\b/gi,
  planned: /\bplanned\b/gi,
  blocked: /\bblocked\b/gi,
  incompleteKo: /미구현|미완료|누락/g,
};

function walkMarkdown(root, recursive = true) {
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.next') continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory() && recursive) out.push(...walkMarkdown(full, true));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) out.push(full);
  }
  return out;
}

const configuredRoots = [
  { label: 'new/docs', root: path.resolve(cwd, 'docs'), recursive: true },
  { label: '7.3 example', root: path.resolve(cwd, '../7.3 example'), recursive: true },
  { label: 'new root', root: cwd, recursive: false },
  { label: 'nexyfab.com root', root: path.resolve(cwd, '..'), recursive: false },
];
const emptyReferenceRoots = [
  path.resolve(cwd, '../document(manuals)'),
  path.resolve(cwd, '../BIM 적용지침(단지분야) 개정(안) 및 부속서 전문'),
];

const files = [...new Set(configuredRoots.flatMap(item => walkMarkdown(item.root, item.recursive)))].sort();
const duplicateHashes = new Map();
const records = files.map(file => {
  const text = fs.readFileSync(file, 'utf8');
  const digest = crypto.createHash('sha256').update(text).digest('hex');
  const title = text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null;
  const markers = Object.fromEntries(Object.entries(markerPatterns).map(([name, pattern]) => [name, [...text.matchAll(pattern)].length]));
  const missingLocalMarkdownLinks = [];
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    let target = match[1].trim().replace(/^<|>$/g, '').split('#')[0];
    if (!target || target.includes('...') || /^[a-z][a-z0-9+.-]*:/i.test(target) || !target.toLowerCase().endsWith('.md')) continue;
    try { target = decodeURIComponent(target); } catch { /* retain literal target */ }
    if (!fs.existsSync(path.resolve(path.dirname(file), target))) missingLocalMarkdownLinks.push(target);
  }
  const locations = duplicateHashes.get(digest) ?? [];
  locations.push(file);
  duplicateHashes.set(digest, locations);
  return {
    path: path.relative(path.resolve(cwd, '..'), file).replaceAll('\\', '/'),
    bytes: Buffer.byteLength(text), sha256: digest, title,
    headings: [...text.matchAll(/^#{1,6}\s+/gm)].length,
    markers,
    missingLocalMarkdownLinks: [...new Set(missingLocalMarkdownLinks)].sort(),
  };
});

const duplicates = [...duplicateHashes.entries()]
  .filter(([, locations]) => locations.length > 1)
  .map(([sha256, locations]) => ({
    sha256,
    paths: locations.map(file => path.relative(path.resolve(cwd, '..'), file).replaceAll('\\', '/')).sort(),
  }));
const missingLinks = records.flatMap(record => record.missingLocalMarkdownLinks.map(target => ({ path: record.path, target })));
const report = {
  schema: 'nexyfab.markdown-corpus-audit.v1',
  generatedAt: new Date().toISOString(),
  policy: {
    sourceMutation: false,
    dependenciesExcluded: ['node_modules', '.git', '.next'],
    semanticAuthority: 'ACTIVE_EXECUTION_MASTER.md; historical plans remain non-authoritative',
  },
  roots: configuredRoots.map(item => ({
    label: item.label,
    exists: fs.existsSync(item.root),
    markdownCount: walkMarkdown(item.root, item.recursive).length,
  })),
  nonMarkdownReferenceRoots: emptyReferenceRoots.map(root => ({
    label: path.basename(root), exists: fs.existsSync(root), markdownCount: walkMarkdown(root, true).length,
  })),
  summary: {
    markdownFiles: records.length,
    bytes: records.reduce((sum, record) => sum + record.bytes, 0),
    filesWithoutH1: records.filter(record => !record.title).length,
    duplicateContentGroups: duplicates.length,
    missingLocalMarkdownLinks: missingLinks.length,
    markerCounts: Object.fromEntries(Object.keys(markerPatterns).map(name => [name, records.reduce((sum, record) => sum + record.markers[name], 0)])),
  },
  missingLinks,
  duplicateContent: duplicates,
  files: records,
};

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, output: path.relative(cwd, output).replaceAll('\\', '/'), ...report.summary }));
