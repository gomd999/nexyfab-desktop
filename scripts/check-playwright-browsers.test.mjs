import assert from 'node:assert/strict';
import test from 'node:test';
import { browserInstallIssues } from './check-playwright-browsers.mjs';

test('browser preflight reports missing executables with scoped install commands', () => {
  const issues = browserInstallIssues({ chromium: process.execPath, firefox: 'Z:/missing/firefox' });
  assert.deepEqual(issues, [{
    name: 'firefox',
    executable: 'Z:/missing/firefox',
    installCommand: 'npx playwright install --with-deps firefox',
  }]);
});

test('browser preflight accepts existing executables', () => {
  assert.deepEqual(browserInstallIssues({ chromium: process.execPath }), []);
});
