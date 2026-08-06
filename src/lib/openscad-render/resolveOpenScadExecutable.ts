import { existsSync } from 'node:fs';

/** Resolve a local CLI without mutating PATH. Explicit deployment config
 * always wins; Windows installer locations are development fallbacks. */
export function resolveOpenScadExecutable(): string {
  const configured = process.env.OPENSCAD_BIN?.trim();
  if (configured) return configured;
  if (process.platform !== 'win32') return 'openscad';
  const candidates = [
    'C:\\Program Files\\OpenSCAD\\openscad.com',
    'C:\\Program Files\\OpenSCAD (Nightly)\\openscad.com',
    'C:\\Program Files (x86)\\OpenSCAD\\openscad.com',
  ];
  return candidates.find(existsSync) ?? 'openscad.com';
}
