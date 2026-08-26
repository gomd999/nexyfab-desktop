import fs from 'node:fs';
import path from 'node:path';
import {
  TEXT_BINDING_CANONICALIZATION,
  canonicalTextBinding,
} from './canonical-text-binding.mjs';

const root = process.cwd();
const output = path.join(root, 'docs', 'evidence', 'security', 'supply-chain-manifest-260810.json');
const inputs = [
  'package-lock.json',
  'docs/evidence/security/sbom-cyclonedx-260810.json',
  'docs/evidence/security/dependency-audit-260810.json',
  'docs/evidence/cad-independent/kernel-stack-identity.json',
  'src/content/third-party-notices.generated.json',
];

function hashFile(relativePath) {
  const binding = canonicalTextBinding(fs.readFileSync(path.join(root, relativePath)));
  return {
    path: relativePath,
    bytes: binding.bytes,
    sha256: binding.sha256,
  };
}

const artifacts = inputs.map(hashFile);
const sbom = JSON.parse(fs.readFileSync(path.join(root, inputs[1]), 'utf8').replace(/^\uFEFF/, ''));
const audit = JSON.parse(fs.readFileSync(path.join(root, inputs[2]), 'utf8'));
const report = {
  schema: 'nexyfab-supply-chain-manifest-v1',
  textCanonicalization: TEXT_BINDING_CANONICALIZATION,
  generatedAt: new Date().toISOString(),
  status: sbom.bomFormat === 'CycloneDX'
    && sbom.specVersion === '1.5'
    && audit.status === 'pass'
    && artifacts.every(item => item.bytes > 0) ? 'pass' : 'fail',
  sbom: {
    format: sbom.bomFormat,
    specVersion: sbom.specVersion,
    components: Array.isArray(sbom.components) ? sbom.components.length : 0,
    dependencies: Array.isArray(sbom.dependencies) ? sbom.dependencies.length : 0,
  },
  dependencyAudit: audit.vulnerabilities,
  artifacts,
};
const serialized = `${JSON.stringify(report, null, 2)}\n`;

if (process.argv.includes('--write')) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, serialized);
} else if (!fs.existsSync(output)) {
  console.error(JSON.stringify({ ok: false, code: 'SUPPLY_CHAIN_EVIDENCE_MISSING' }));
  process.exitCode = 1;
} else {
  const stored = JSON.parse(fs.readFileSync(output, 'utf8'));
  const comparable = { ...report, generatedAt: stored.generatedAt };
  if (JSON.stringify(comparable) !== JSON.stringify(stored)) {
    console.error(JSON.stringify({ ok: false, code: 'SUPPLY_CHAIN_EVIDENCE_STALE' }));
    process.exitCode = 1;
  }
}

console.log(JSON.stringify({ ok: report.status === 'pass', ...report.sbom, vulnerabilities: audit.vulnerabilities.total, artifacts: artifacts.length }));
if (report.status !== 'pass') process.exitCode = 1;
