#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { getScope, readRegistry, workspaceDirectory } from './workspace-registry.mjs';

const registry = readRegistry();
const argument = process.argv[2];
if (argument === '--list') {
  console.log(JSON.stringify(registry.scopes.map(scope => ({
    id: scope.id,
    label: scope.label,
    branch: scope.branch,
    worktreeDirectory: scope.worktreeDirectory,
  })), null, 2));
  process.exit(0);
}

const scope = getScope(registry, argument);
const directory = workspaceDirectory(scope);
for (const name of ['AGENTS.md', 'CURRENT.md', 'DECISIONS.md']) {
  const file = path.join(directory, name);
  process.stdout.write(`\n===== ${scope.id}/${name} =====\n`);
  process.stdout.write(fs.readFileSync(file, 'utf8'));
  process.stdout.write('\n');
}
