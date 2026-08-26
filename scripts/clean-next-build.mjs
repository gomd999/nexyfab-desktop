#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SAFE_DIST_DIR = /^\.next(?:-[a-z0-9][a-z0-9-]*)?$/;

export function resolveNextBuildTarget({
  projectRoot = process.cwd(),
  distDir = process.env.NEXT_DIST_DIR || '.next',
} = {}) {
  const root = path.resolve(projectRoot);
  if (typeof distDir !== 'string' || !SAFE_DIST_DIR.test(distDir)) {
    throw new Error(`Refusing to clean unexpected Next dist directory: ${String(distDir)}`);
  }
  const target = path.resolve(root, distDir);
  if (path.dirname(target) !== root || path.basename(target) !== distDir) {
    throw new Error(`Refusing to clean unexpected Next build path: ${target}`);
  }
  return { root, target, distDir };
}

export function cleanNextBuild(options = {}) {
  const resolved = resolveNextBuildTarget(options);
  fs.rmSync(resolved.target, {
    recursive: true,
    force: true,
    // Windows can briefly retain Next.js cache handles after a dev server exits.
    // Keep the target guard above, then retry only the same verified directory.
    maxRetries: 12,
    retryDelay: 250,
  });
  return resolved;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const result = cleanNextBuild();
  process.stdout.write(`${JSON.stringify({ event: 'next-build-cache-cleaned', target: result.distDir })}\n`);
}
