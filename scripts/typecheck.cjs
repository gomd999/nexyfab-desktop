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

// This project includes the complete multi-domain CAD type graph. On Windows
// the default V8 old-space limit can be exhausted before TypeScript reports a
// diagnostic. Keep a caller-provided limit, otherwise give the child compiler
// the same 8 GB ceiling used by the verified direct command. NODE_OPTIONS must
// be set on the child because increasing the wrapper process heap does not
// propagate automatically.
const existingNodeOptions = process.env.NODE_OPTIONS || '';
const childNodeOptions = /--max-old-space-size(?:=|\s)\d+/.test(existingNodeOptions)
  ? existingNodeOptions
  : `${existingNodeOptions} --max-old-space-size=8192`.trim();

const r = spawnSync('npx', ['tsc', '--noEmit'], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, NODE_OPTIONS: childNodeOptions },
});

process.exit(r.status === null ? 1 : r.status);
