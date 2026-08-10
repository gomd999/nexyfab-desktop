import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('secret evidence never contains the matched secret value', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'scripts', 'scan-secrets.mjs'), 'utf8');
  assert.match(source, /fingerprint:/);
  assert.doesNotMatch(source, /value:\s*match\[0\]/);
});

test('scanner patterns cover private keys and major provider credentials', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'scripts', 'scan-secrets.mjs'), 'utf8');
  for (const name of ['private_key', 'aws_access_key', 'google_api_key', 'github_token', 'stripe_live_secret', 'openai_secret']) {
    assert.match(source, new RegExp(`['"]${name}['"]`));
  }
});
