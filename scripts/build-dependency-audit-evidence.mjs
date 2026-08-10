import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const output = path.join(root, 'docs', 'evidence', 'security', 'dependency-audit-260810.json');
const npmCli = process.env.npm_execpath
  || (process.platform === 'win32'
    ? path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
    : null);
const auditCommand = npmCli ? process.execPath : 'npm';
const auditArgs = npmCli ? [npmCli, 'audit', '--audit-level=low', '--json'] : ['audit', '--audit-level=low', '--json'];
const run = spawnSync(auditCommand, auditArgs, {
  cwd: root,
  encoding: 'utf8',
  windowsHide: true,
  maxBuffer: 32 * 1024 * 1024,
});

let audit;
try {
  audit = JSON.parse(run.stdout || '{}');
} catch {
  console.error(JSON.stringify({ ok: false, code: 'AUDIT_OUTPUT_INVALID' }));
  process.exit(1);
}

const counts = audit?.metadata?.vulnerabilities ?? {};
const total = Number(counts.total ?? Object.keys(audit.vulnerabilities ?? {}).length);
const lockBytes = fs.readFileSync(path.join(root, 'package-lock.json'));
const report = {
  schema: 'nexyfab-dependency-audit-v1',
  generatedAt: new Date().toISOString(),
  command: 'npm audit --audit-level=low --json',
  packageLockSha256: createHash('sha256').update(lockBytes).digest('hex'),
  status: total === 0 ? 'pass' : 'fail',
  vulnerabilities: {
    info: Number(counts.info ?? 0), low: Number(counts.low ?? 0),
    moderate: Number(counts.moderate ?? 0), high: Number(counts.high ?? 0),
    critical: Number(counts.critical ?? 0), total,
  },
  dependencies: audit?.metadata?.dependencies ?? null,
};

if (process.argv.includes('--write')) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
} else if (!fs.existsSync(output)) {
  console.error(JSON.stringify({ ok: false, code: 'DEPENDENCY_AUDIT_EVIDENCE_MISSING' }));
  process.exitCode = 1;
} else {
  const stored = JSON.parse(fs.readFileSync(output, 'utf8'));
  const comparable = { ...report, generatedAt: stored.generatedAt };
  if (JSON.stringify(comparable) !== JSON.stringify(stored)) {
    console.error(JSON.stringify({ ok: false, code: 'DEPENDENCY_AUDIT_EVIDENCE_STALE' }));
    process.exitCode = 1;
  }
}

console.log(JSON.stringify({ ok: report.status === 'pass', ...report.vulnerabilities }));
// npm audit may return a platform-specific non-zero status even when it emits a
// complete JSON report with zero vulnerabilities. The parsed report is the
// authority; fail only when it is incomplete or contains findings.
const completeAuditReport = audit?.metadata?.vulnerabilities != null;
process.exitCode = report.status === 'pass' && completeAuditReport ? 0 : 1;
