#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { collectChangedPaths, currentBranch, currentHead, getScope, readRegistry, workspaceDirectory } from './workspace-registry.mjs';

const registry = readRegistry();
const scope = getScope(registry, process.argv[2]);
const slug = String(process.argv[3] ?? '').trim().toLowerCase();
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('workspace_handoff_slug_invalid');
const branch = currentBranch();
if (branch !== scope.branch) throw new Error(`workspace_branch_mismatch:${branch}:${scope.branch}`);

const now = new Date();
const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const destination = path.join(workspaceDirectory(scope), 'HANDOFFS', `${stamp}-${slug}.md`);
if (fs.existsSync(destination)) throw new Error(`workspace_handoff_exists:${destination}`);
const changedPaths = collectChangedPaths(registry);
const content = `# ${scope.label} handoff: ${slug}\n\n- Created: ${now.toISOString()}\n- Branch: \`${branch}\`\n- Head: \`${currentHead()}\`\n- Integration target: \`${registry.integrationBranch}\`\n\n## Summary\n\nTODO: summarize the completed outcome.\n\n## Changed paths\n\n${changedPaths.length ? changedPaths.map(file => `- \`${file}\``).join('\n') : '- None'}\n\n## Verification\n\n${scope.checks.map(check => `- [ ] \`${check}\``).join('\n')}\n\n## Remaining work and risks\n\n- TODO\n`;
fs.writeFileSync(destination, content, { encoding: 'utf8', flag: 'wx' });
console.log(JSON.stringify({ ok: true, scope: scope.id, destination: path.relative(process.cwd(), destination).replaceAll('\\', '/') }));
