import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = path.resolve('scripts/build-supply-chain-evidence.mjs');

function writeFixture(root, lineEnding = '\n') {
  const files = {
    'package-lock.json': '{}\n',
    'docs/evidence/security/sbom-cyclonedx-260810.json': `${JSON.stringify({
      bomFormat: 'CycloneDX',
      specVersion: '1.5',
      components: [],
      dependencies: [],
    }, null, 2)}\n`,
    'docs/evidence/security/dependency-audit-260810.json': `${JSON.stringify({
      status: 'pass',
      vulnerabilities: { total: 0 },
    }, null, 2)}\n`,
    'docs/evidence/cad-independent/kernel-stack-identity.json': '{"schema":"fixture"}\n',
    'src/content/third-party-notices.generated.json': '{"schema":"fixture"}\n',
  };

  for (const [relative, source] of Object.entries(files)) {
    const output = path.join(root, ...relative.split('/'));
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, source.replaceAll('\n', lineEnding));
  }
}

function run(root, args = []) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
}

test('supply-chain bindings are stable across LF and CRLF checkouts', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-supply-chain-'));
  try {
    writeFixture(fixture, '\n');
    const generated = run(fixture, ['--write']);
    assert.equal(generated.status, 0, generated.stderr || generated.stdout);

    writeFixture(fixture, '\r\n');
    const checked = run(fixture);
    assert.equal(checked.status, 0, checked.stderr || checked.stdout);

    const receipt = JSON.parse(fs.readFileSync(path.join(
      fixture,
      'docs',
      'evidence',
      'security',
      'supply-chain-manifest-260810.json',
    ), 'utf8'));
    assert.equal(receipt.textCanonicalization, 'utf8-crlf-to-lf');
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
