import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPORT = path.join(ROOT, 'docs/evidence/security/git-history-cleanup-preflight.json');
const CANDIDATES = ['public/send-mail.php', 'public/uploads'];

function git(args, cwd = ROOT) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', shell: false, windowsHide: true });
  return { ok: result.status === 0, stdout: result.stdout?.trim() ?? '', stderr: result.stderr?.trim() ?? '' };
}

function sha256File(file) {
  const hash = createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function historyCount(candidate) {
  const result = git(['log', '--all', '--format=%H', '--', candidate]);
  if (!result.ok) throw new Error(`Unable to inspect history for ${candidate}`);
  return new Set(result.stdout.split(/\r?\n/).filter(Boolean)).size;
}

function trackedCount(candidate) {
  const result = git(['ls-files', candidate, `${candidate}/**`]);
  if (!result.ok) throw new Error(`Unable to inspect tracked paths for ${candidate}`);
  return result.stdout.split(/\r?\n/).filter(Boolean).length;
}

function worktreeStates() {
  const listing = git(['worktree', 'list', '--porcelain']);
  if (!listing.ok) throw new Error('Unable to list worktrees');
  const blocks = listing.stdout.split(/\r?\n\r?\n/).filter(Boolean);
  return blocks.map((block) => {
    const lines = block.split(/\r?\n/);
    const directory = lines.find((line) => line.startsWith('worktree '))?.slice(9) ?? '';
    const branch = lines.find((line) => line.startsWith('branch '))?.slice('branch refs/heads/'.length) ?? 'detached';
    const status = git(['status', '--short'], directory);
    return {
      name: path.basename(directory),
      branch,
      dirtyFileCount: status.stdout.split(/\r?\n/).filter(Boolean).length,
    };
  });
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? '' : '';
}

function main() {
  const bundle = path.resolve(argument('--bundle'));
  if (!fs.existsSync(bundle)) throw new Error('A verified --bundle path is required');
  const bundleVerify = git(['bundle', 'verify', bundle]);
  const repositoryFsck = git(['fsck', '--full', '--no-progress']);
  const refs = git(['for-each-ref', '--format=%(refname)']);
  const head = git(['rev-parse', 'HEAD']);
  const filterRepo = git(['filter-repo', '--version']);
  const worktrees = worktreeStates();
  const candidatePaths = CANDIDATES.map((candidate) => ({
    path: candidate,
    reachableCommitCount: historyCount(candidate),
    trackedEntryCountAtHead: trackedCount(candidate),
  }));
  const report = {
    schema: 'nexyfab.git-history-cleanup-preflight.v1',
    generatedAt: new Date().toISOString(),
    integrationHead: head.stdout,
    mutationPerformed: false,
    authorizationRequiredBeforeRewrite: true,
    backup: {
      file: path.basename(bundle),
      byteLength: fs.statSync(bundle).size,
      sha256: sha256File(bundle),
      verification: bundleVerify.ok ? 'PASS' : 'FAIL',
    },
    repository: {
      fsck: repositoryFsck.ok ? 'PASS' : 'FAIL',
      refCount: refs.stdout.split(/\r?\n/).filter(Boolean).length,
      worktreeCount: worktrees.length,
      filterRepoAvailable: filterRepo.ok,
    },
    candidatePaths,
    dirtyWorktrees: worktrees.filter((worktree) => worktree.dirtyFileCount > 0),
    requiredBeforeRewrite: [
      'rotate every exposed credential before treating history removal as remediation',
      'freeze pushes and collect or commit every dirty worktree',
      'install git-filter-repo and agree the exact path and replacement rules',
      'coordinate force-push timing and protected-branch overrides',
      're-clone or rebase every collaborator and CI checkout after the rewrite',
      'repeat secret scanning, repository fsck, and bundle verification on rewritten refs',
    ],
  };

  if (process.argv.includes('--write')) fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));
  if (!bundleVerify.ok || !repositoryFsck.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
