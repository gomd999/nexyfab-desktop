/**
 * After `next build` with `output: 'standalone'`, client chunks live in `.next/static`
 * but must also exist at `.next/standalone/.next/static` for `node .next/standalone/server.js`
 * (see Next.js standalone docs). Without this copy, all `/_next/static/*` requests 404
 * and the shape-generator shell stays on "Loading 3D workspace…".
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = process.env.NEXT_DIST_DIR || '.next';
const standaloneServer = path.join(root, distDir, 'standalone', 'server.js');
const staticSrc = path.join(root, distDir, 'static');
const staticDest = path.join(root, distDir, 'standalone', distDir, 'static');
// Next 16.3's file tracer can omit this small runtime closure on Windows,
// causing `server.js` to fail only after an otherwise successful build.
const nextLibSrc = path.join(root, 'node_modules', 'next', 'dist', 'lib');
const nextLibDest = path.join(root, distDir, 'standalone', 'node_modules', 'next', 'dist', 'lib');

if (!fs.existsSync(standaloneServer)) {
  process.exit(0);
}
if (!fs.existsSync(staticSrc)) {
  console.warn('[sync-standalone-static] skip: .next/static not found');
  process.exit(0);
}
fs.mkdirSync(path.dirname(staticDest), { recursive: true });
fs.cpSync(staticSrc, staticDest, { recursive: true, force: true });
if (fs.existsSync(nextLibSrc)) {
  fs.mkdirSync(path.dirname(nextLibDest), { recursive: true });
  fs.cpSync(nextLibSrc, nextLibDest, { recursive: true, force: true });
}
