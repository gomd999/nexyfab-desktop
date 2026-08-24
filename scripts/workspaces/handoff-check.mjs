#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { evaluateHandoffDocument, selectLatestValidHandoff } from './handoff-validation.mjs';
import { getScope, readRegistry, resolveOwnership, runGit, workspaceDirectory } from './workspace-registry.mjs';

const registry = readRegistry();
const scope = getScope(registry, process.argv[2]);
const directory = path.join(workspaceDirectory(scope), 'HANDOFFS');
const requested = process.argv[3];
const candidates = fs.readdirSync(directory).filter(name => /^\d{8}T\d{6}Z-.+\.md$/.test(name)).sort();
const resolveResult = (markdown) => {
  const result = evaluateHandoffDocument(markdown, scope, registry, resolveOwnership);
  if (result.head) {
    try {
      const resolved = runGit(['show', '-s', '--format=%H', result.head]).trim();
      if (resolved !== result.head) result.issues.push('handoff_head_not_resolved');
    } catch {
      result.issues.push('handoff_head_not_resolved');
    }
  }
  result.ok = result.issues.length === 0;
  return result;
};

let file;
let result;
if (requested) {
  file = path.resolve(process.cwd(), requested);
} else {
  const selected = selectLatestValidHandoff(
    candidates.map(name => ({ name, markdown: fs.readFileSync(path.join(directory, name), 'utf8') })),
    resolveResult,
  );
  file = path.join(directory, selected?.candidate.name ?? candidates.at(-1) ?? 'missing');
  result = selected?.result;
}
const relative = path.relative(directory, file);
if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(file)) throw new Error('workspace_handoff_file_invalid');
result ??= resolveResult(fs.readFileSync(file, 'utf8'));
console.log(JSON.stringify({ ...result, scope: scope.id, file: path.relative(process.cwd(), file).replaceAll('\\', '/') }, null, 2));
if (!result.ok) process.exitCode = 1;
