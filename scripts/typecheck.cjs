'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const generatedNextTypeDirs = [
  path.join(root, '.next', 'dev'),
  path.join(root, '.next', 'types'),
];

for (const dir of generatedNextTypeDirs) {
  if (!fs.existsSync(dir)) continue;
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
    console.log(`[typecheck] removed ${path.relative(root, dir)} (avoids stale Next.js generated route types)`);
  } catch (e) {
    console.warn(`[typecheck] could not remove ${path.relative(root, dir)} (continuing):`, (e && e.message) || e);
  }
}

const r = spawnSync('npx', ['tsc', '--noEmit'], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
  env: process.env,
});

process.exit(r.status === null ? 1 : r.status);
