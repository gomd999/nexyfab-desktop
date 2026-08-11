#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const target = path.resolve(root, '.next');

if (path.dirname(target) !== root || path.basename(target) !== '.next') {
  throw new Error(`Refusing to clean unexpected Next build path: ${target}`);
}

fs.rmSync(target, { recursive: true, force: true });
process.stdout.write(`${JSON.stringify({ event: 'next-build-cache-cleaned', target: '.next' })}\n`);
