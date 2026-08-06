#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
const reqPath = path.resolve('docs/cad-program/requirements/manual-requirements.json');
const indexPath = path.resolve('docs/cad-program/requirements/manual-index.json');
const req = JSON.parse(readFileSync(reqPath, 'utf8'));
const index = JSON.parse(readFileSync(indexPath, 'utf8'));
const issues = [];
if (index.count !== 20) issues.push(`expected 20 manuals, got ${index.count}`);
const ids = new Set();
for (const item of req.requirements) {
  if (ids.has(item.id)) issues.push(`duplicate requirement ${item.id}`);
  ids.add(item.id);
  if (!req.statusVocabulary.includes(item.status)) issues.push(`invalid status ${item.id}:${item.status}`);
  if (item.status === 'implemented_verified' && (!item.coreModules?.length || !item.goldenScenario)) issues.push(`verified requirement lacks evidence links: ${item.id}`);
  for (const module of item.coreModules || []) if (!existsSync(path.resolve(module))) issues.push(`missing module ${item.id}:${module}`);
}
if (issues.length) { process.stderr.write(`${issues.join('\n')}\n`); process.exitCode = 1; }
else process.stdout.write(`trace valid: ${index.count} manuals, ${req.requirements.length} baseline requirements\n`);

