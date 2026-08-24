import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = process.cwd();
const OUTPUT = path.join(ROOT, 'docs', 'evidence', 'security', 'secret-scan-260810.json');
const WRITE = process.argv.includes('--write');
const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.json', '.yaml', '.yml',
  '.toml', '.env', '.example', '.md', '.txt', '.html', '.xml', '.ini', '.conf',
  '.properties', '.sql', '.sh', '.bat', '.ps1', '.py', '.rs',
]);
const TEXT_BASENAMES = new Set([
  '.env', '.npmrc', '.pypirc', '.yarnrc',
  'Dockerfile', 'LICENSE', 'Makefile', 'NOTICE', 'Procfile',
]);
const MAX_TEXT_BYTES = 32 * 1024 * 1024;

const PATTERNS = [
  ['private_key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g],
  ['aws_access_key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['google_api_key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['github_token', /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}\b/g],
  ['stripe_live_secret', /\bsk_live_[A-Za-z0-9]{20,}\b/g],
  ['openai_secret', /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/g],
  ['slack_token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g],
];

function versionedCandidateTextFiles() {
  const git = spawnSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
    cwd: ROOT,
    encoding: 'buffer',
    windowsHide: true,
  });
  if (git.status !== 0 || git.error) throw new Error(`SECRET_SCAN_GIT_FILES_UNAVAILABLE:${git.error?.code ?? git.status}`);
  return git.stdout.toString('utf8').split('\0').filter(Boolean).filter(relativePath => {
    const base = path.basename(relativePath);
    return base.startsWith('.env') || TEXT_EXTENSIONS.has(path.extname(base).toLowerCase()) || TEXT_BASENAMES.has(base);
  });
}

function scan(relativeFiles = versionedCandidateTextFiles()) {
  const files = [...new Set(relativeFiles)]
    .map(file => path.resolve(ROOT, file))
    .filter(file => file !== OUTPUT && fs.existsSync(file))
    .sort();
  const findings = [];
  let bytesScanned = 0;
  let oversizedFilesSkipped = 0;
  for (const file of files) {
    const size = fs.statSync(file).size;
    if (size > MAX_TEXT_BYTES) {
      oversizedFilesSkipped += 1;
      continue;
    }
    const content = fs.readFileSync(file, 'utf8');
    bytesScanned += Buffer.byteLength(content);
    for (const [pattern, regex] of PATTERNS) {
      regex.lastIndex = 0;
      for (const match of content.matchAll(regex)) {
        const before = content.slice(0, match.index);
        findings.push({
          file: path.relative(ROOT, file).replaceAll('\\', '/'),
          line: before.split(/\r?\n/).length,
          pattern,
          fingerprint: createHash('sha256').update(match[0]).digest('hex').slice(0, 16),
        });
      }
    }
  }
  return {
    schema: 'nexyfab-secret-scan-v1',
    generatedAt: new Date().toISOString(),
    scope: 'git-versioned-candidates-text',
    status: findings.length === 0 && oversizedFilesSkipped === 0 ? 'pass' : 'fail',
    filesScanned: files.length,
    bytesScanned,
    oversizedFilesSkipped,
    findingCount: findings.length,
    findings,
  };
}

const report = scan();
const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (WRITE) {
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, serialized);
} else if (!fs.existsSync(OUTPUT)) {
  console.error(JSON.stringify({ ok: false, code: 'SECRET_SCAN_EVIDENCE_MISSING' }));
  process.exitCode = 1;
} else {
  const stored = JSON.parse(fs.readFileSync(OUTPUT, 'utf8'));
  const comparable = { ...report, generatedAt: stored.generatedAt };
  if (JSON.stringify(comparable) !== JSON.stringify(stored)) {
    console.error(JSON.stringify({ ok: false, code: 'SECRET_SCAN_EVIDENCE_STALE' }));
    process.exitCode = 1;
  }
}
console.log(JSON.stringify({
  ok: report.status === 'pass',
  scope: report.scope,
  filesScanned: report.filesScanned,
  bytesScanned: report.bytesScanned,
  oversizedFilesSkipped: report.oversizedFilesSkipped,
  findings: report.findingCount,
}));
if (report.status !== 'pass') process.exitCode = 1;

export { scan };

if (process.argv[1] && fileURLToPath(import.meta.url) !== path.resolve(process.argv[1])) {
  // Imported by tests: the top-level scan remains deterministic and read-only.
}
