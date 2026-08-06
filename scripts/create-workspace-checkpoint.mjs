#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const output = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), `nexyfab-workspace-checkpoint-${stamp}`));
const tempRoots = [path.resolve(os.tmpdir()), ...(process.platform === 'win32' ? [path.resolve('C:/tmp')] : [])];
const insideApprovedTemp = tempRoots.some(tempRoot => { const relativeOutput = path.relative(tempRoot, output); return Boolean(relativeOutput) && !relativeOutput.startsWith('..') && !path.isAbsolute(relativeOutput); });
if (!insideApprovedTemp) throw new Error('checkpoint_output_must_be_inside_temp');
if (fs.existsSync(output)) throw new Error(`checkpoint_output_exists:${output}`);

const git = (args, options = {}) => {
  const result = spawnSync('git', args, { cwd: root, encoding: options.encoding ?? 'utf8', windowsHide: true, maxBuffer: 128 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? `git_exit:${result.status}:${String(result.stderr).slice(-1000)}`);
  return result.stdout;
};
const paths = args => String(git(args)).split('\0').filter(Boolean);
const safeSource = relative => {
  const absolute = path.resolve(root, relative);
  const rel = path.relative(root, absolute);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || rel.split(path.sep).includes('.git')) throw new Error(`checkpoint_unsafe_path:${relative}`);
  return { absolute, relative: rel.replaceAll('\\', '/') };
};
const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

const modified = new Set(paths(['diff', '--name-only', '-z']));
const staged = new Set(paths(['diff', '--cached', '--name-only', '-z']));
const untracked = new Set(paths(['ls-files', '--others', '--exclude-standard', '-z']));
const deleted = new Set([...modified, ...staged].filter(relative => !fs.existsSync(path.resolve(root, relative))));
const present = [...new Set([...modified, ...staged, ...untracked])].filter(relative => !deleted.has(relative)).sort();

fs.mkdirSync(path.join(output, 'files'), { recursive: true });
const records = [];
for (const item of present) {
  const source = safeSource(item);
  if (!fs.statSync(source.absolute).isFile()) continue;
  const destination = path.resolve(output, 'files', ...source.relative.split('/'));
  const relativeDestination = path.relative(path.join(output, 'files'), destination);
  if (!relativeDestination || relativeDestination.startsWith('..') || path.isAbsolute(relativeDestination)) throw new Error(`checkpoint_destination_unsafe:${item}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source.absolute, destination);
  const sourceHash = sha256(source.absolute), copiedHash = sha256(destination);
  if (sourceHash !== copiedHash) throw new Error(`checkpoint_copy_hash_mismatch:${item}`);
  records.push({ path: source.relative, category: untracked.has(item) ? 'untracked' : staged.has(item) ? 'staged' : 'modified', bytes: fs.statSync(source.absolute).size, sha256: sourceHash });
}

const writePatch = (name, args) => {
  const destination = path.join(output, name);
  git([...args, `--output=${destination}`]);
  return { path: name, bytes: fs.statSync(destination).size, sha256: sha256(destination) };
};
const patches = [writePatch('tracked-working-tree.patch', ['diff', '--binary', '--no-ext-diff']), writePatch('tracked-index.patch', ['diff', '--cached', '--binary', '--no-ext-diff'])];
const head = String(git(['rev-parse', 'HEAD'])).trim();
const branch = String(git(['branch', '--show-current'])).trim();
const status = String(git(['status', '--short', '--untracked-files=all']));
const fileSetSha256 = createHash('sha256').update(records.map(item => `${item.path}\0${item.bytes}\0${item.sha256}`).join('\n')).digest('hex');
const manifest = { schema: 'nexyfab.workspace-checkpoint.v1', generatedAt: new Date().toISOString(), repositoryRoot: root, head, branch, recoverable: true, includesSourceBytes: true, summary: { files: records.length, modified: records.filter(item => item.category === 'modified').length, staged: records.filter(item => item.category === 'staged').length, untracked: records.filter(item => item.category === 'untracked').length, deleted: deleted.size, bytes: records.reduce((sum, item) => sum + item.bytes, 0) }, fileSetSha256, patches, deleted: [...deleted].sort(), files: records };
fs.writeFileSync(path.join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
fs.writeFileSync(path.join(output, 'git-status.txt'), status, 'utf8');
fs.writeFileSync(path.join(output, 'RESTORE.md'), `# NexyFab workspace checkpoint restore\n\n- Base HEAD: \`${head}\`\n- Branch: \`${branch || '(detached)'}\`\n- File set: \`${fileSetSha256}\`\n\nRestore into a separate clean clone/worktree at the base HEAD. Apply \`tracked-index.patch\` and \`tracked-working-tree.patch\` with \`git apply --binary\`, then copy the contents of \`files/\` over the repository root. Do not restore over the only working copy. Verify every copied file against \`manifest.json\`.\n`, 'utf8');
console.log(JSON.stringify({ output, ...manifest.summary, fileSetSha256, head, branch }));
