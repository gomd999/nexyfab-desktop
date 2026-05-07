import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const src = path.join(
  root,
  'node_modules',
  'occt-import-js',
  'test',
  'testfiles',
  'simple-basic-cube',
  'cube.stp',
);
const out = path.join(root, 'src', 'lib', 'cad', 'ap214NxCubeTemplate.ts');
const body = fs.readFileSync(src, 'utf8');
const escaped = body.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
const hdr = `/**
 * AP214 AUTOMOTIVE_DESIGN axis-aligned box (MANIFOLD_SOLID_BREP).
 * Vertex coordinates are remapped at export — see remapAp214NxCubeToBox.
 *
 * Template source: occt-import-js (MIT) test asset simple-basic-cube/cube.stp (NX).
 */
export const AP214_NX_CUBE_STEP_TEMPLATE = \``;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${hdr}${escaped}\` as const;\n`);
