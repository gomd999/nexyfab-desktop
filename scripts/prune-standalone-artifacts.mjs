#!/usr/bin/env node
import { existsSync, lstatSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageReleaseHealthEvidence } from './package-release-health-evidence.mjs';

function bytesUnder(target) {
  if (!existsSync(target)) return 0;
  const stat = lstatSync(target);
  if (!stat.isDirectory()) return stat.size;
  return readdirSync(target, { withFileTypes: true }).reduce(
    (sum, entry) => sum + bytesUnder(path.join(target, entry.name)),
    0,
  );
}

function assertGeneratedStandalone(projectRoot, standaloneRoot) {
  const relative = path.relative(projectRoot, standaloneRoot);
  if (
    !relative ||
    relative.startsWith('..') ||
    path.isAbsolute(relative) ||
    path.basename(standaloneRoot) !== 'standalone'
  ) {
    throw new Error(`refusing to prune unsafe standalone path: ${standaloneRoot}`);
  }
}

export function pruneStandaloneArtifacts({
  projectRoot = process.cwd(),
  distDir = process.env.NEXT_DIST_DIR || '.next',
  stripDockerDuplicates = false,
} = {}) {
  const root = path.resolve(projectRoot);
  const standalone = path.resolve(root, distDir, 'standalone');
  assertGeneratedStandalone(root, standalone);
  if (!existsSync(standalone) || !statSync(standalone).isDirectory()) {
    return { removed: [], freedBytes: 0, standalone, releaseHealthEvidence: null };
  }

  // Next excludes docs from file tracing. Copy only the fixed, runtime
  // receipt files before pruning; never copy the docs tree or secret-bearing
  // local state. Missing/invalid receipts fail the build closed.
  const releaseHealthEvidence = packageReleaseHealthEvidence({
    projectRoot: root,
    standaloneRoot: standalone,
    sourceRoot: process.env.RELEASE_HEALTH_EVIDENCE_SOURCE_DIR
      ? path.resolve(root, process.env.RELEASE_HEALTH_EVIDENCE_SOURCE_DIR)
      : root,
  });

  // These paths are mutable customer/admin state. They may be picked up by
  // Next's broad fs tracing on developer machines, but are never valid image
  // contents. Only generated copies below {distDir}/standalone are touched.
  const targets = [
    path.join(standalone, 'data'),
    path.join(standalone, 'adminlink'),
    path.join(standalone, 'nexyfab.db'),
    path.join(standalone, 'nexyfab.db-wal'),
    path.join(standalone, 'nexyfab.db-shm'),
  ];

  // The Dockerfile copies these from their authoritative builder locations.
  // Stripping their traced duplicates avoids storing them in two image layers.
  if (stripDockerDuplicates) {
    targets.push(
      path.join(standalone, 'public'),
      path.join(standalone, 'scripts', 'drawing-to-3d'),
      path.join(standalone, 'scripts', 'engineering-core'),
    );
  }

  const removed = [];
  let freedBytes = 0;
  for (const target of targets) {
    if (!existsSync(target)) continue;
    const relative = path.relative(standalone, target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`refusing to prune path outside standalone: ${target}`);
    }
    freedBytes += bytesUnder(target);
    rmSync(target, { recursive: true, force: true });
    removed.push(relative.replaceAll('\\', '/'));
  }

  return { removed, freedBytes, standalone, releaseHealthEvidence };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const result = pruneStandaloneArtifacts({
    stripDockerDuplicates: process.argv.includes('--strip-docker-duplicates'),
  });
  console.log(JSON.stringify({
    event: 'standalone-prune',
    removed: result.removed,
    releaseHealthEvidence: result.releaseHealthEvidence?.copied ?? [],
    freedMiB: Math.round((result.freedBytes / 1024 / 1024) * 10) / 10,
  }));
}
