import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  filterSecretScanCandidates,
  isProbablyText,
  scanText,
  SECRET_SCAN_EXCLUDED_DERIVED_RECEIPTS,
} from './scan-secrets.mjs';

test('secret evidence never contains the matched secret value', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'scripts', 'scan-secrets.mjs'), 'utf8');
  assert.match(source, /fingerprint[:,]/);
  assert.doesNotMatch(source, /value:\s*match\[0\]/);
});

test('scanner patterns cover private keys and major provider credentials', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'scripts', 'scan-secrets.mjs'), 'utf8');
  for (const name of ['private_key', 'aws_access_key', 'google_api_key', 'github_token', 'recaptcha_secret', 'stripe_live_secret', 'openai_secret']) {
    assert.match(source, new RegExp(`['"]${name}['"]`));
  }
});

test('scanner detects a reCAPTCHA-shaped secret in a public PHP fixture without retaining its value', () => {
  const syntheticSecret = `6L${'A'.repeat(38)}`;
  const findings = scanText('public/fixture.php', `<?php $secretKey = '${syntheticSecret}';`);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].file, 'public/fixture.php');
  assert.equal(findings[0].pattern, 'recaptcha_secret');
  assert.ok(findings[0].fingerprint);
  assert.equal(JSON.stringify(findings).includes(syntheticSecret), false);
});

test('scanner does not classify a public reCAPTCHA site key as a server secret', () => {
  const syntheticSiteKey = `6L${'B'.repeat(38)}`;
  assert.deepEqual(scanText('public/index.html', `<div data-sitekey="${syntheticSiteKey}"></div>`), []);
});

test('content sniffing scans extensionless text and skips binary data', () => {
  assert.equal(isProbablyText(Buffer.from('RECAPTCHA_SECRET_KEY=example')), true);
  assert.equal(isProbablyText(Buffer.from([0x00, 0x01, 0x02, 0xff])), false);
});

test('scanner excludes only the exact derived current receipts that would create a hash cycle', () => {
  const nearbySource = 'docs/evidence/release/commercial-security-evidence-receipt.fixture.json';
  const candidates = filterSecretScanCandidates([
    ...SECRET_SCAN_EXCLUDED_DERIVED_RECEIPTS,
    nearbySource,
    'src/app/page.tsx',
  ]);
  assert.deepEqual(candidates, [nearbySource, 'src/app/page.tsx']);
});
