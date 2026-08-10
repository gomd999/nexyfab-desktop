import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = process.cwd();
const OUTPUT = path.join(ROOT, 'docs', 'evidence', 'security', 'secret-scan-260810.json');
const WRITE = process.argv.includes('--write');
const ROOTS = ['src', 'scripts', 'security'];
const TOP_LEVEL = ['next.config.ts', 'package.json', '.env.example'];
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', '.tmp', 'validation-reports', 'docs', 'public']);
const TEXT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.yaml', '.yml', '.toml', '.env', '.example']);

const PATTERNS = [
  ['private_key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g],
  ['aws_access_key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['google_api_key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['github_token', /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}\b/g],
  ['stripe_live_secret', /\bsk_live_[A-Za-z0-9]{20,}\b/g],
  ['openai_secret', /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/g],
  ['slack_token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g],
];

function filesUnder(directory) {
  const output = [];
  if (!fs.existsSync(directory)) return output;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...filesUnder(absolute));
    else if (entry.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) output.push(absolute);
  }
  return output;
}

function scan() {
  const files = [
    ...ROOTS.flatMap(root => filesUnder(path.join(ROOT, root))),
    ...TOP_LEVEL.map(file => path.join(ROOT, file)).filter(file => fs.existsSync(file)),
  ].sort();
  const findings = [];
  let bytesScanned = 0;
  for (const file of files) {
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
    status: findings.length === 0 ? 'pass' : 'fail',
    filesScanned: files.length,
    bytesScanned,
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
console.log(JSON.stringify({ ok: report.status === 'pass', filesScanned: report.filesScanned, bytesScanned: report.bytesScanned, findings: report.findingCount }));
if (report.status !== 'pass') process.exitCode = 1;

export { scan };

if (process.argv[1] && fileURLToPath(import.meta.url) !== path.resolve(process.argv[1])) {
  // Imported by tests: the top-level scan remains deterministic and read-only.
}
