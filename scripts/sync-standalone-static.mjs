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
const standaloneServer = path.join(root, '.next', 'standalone', 'server.js');
const staticSrc = path.join(root, '.next', 'static');
const staticDest = path.join(root, '.next', 'standalone', '.next', 'static');

if (!fs.existsSync(standaloneServer)) {
  process.exit(0);
}
if (!fs.existsSync(staticSrc)) {
  console.warn('[sync-standalone-static] skip: .next/static not found');
  process.exit(0);
}
fs.mkdirSync(path.dirname(staticDest), { recursive: true });
fs.cpSync(staticSrc, staticDest, { recursive: true, force: true });
