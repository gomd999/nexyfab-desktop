import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

// esbuild's CJS SEA bundle has __filename but no import.meta.url; source ESM
// has the inverse. Keep both execution modes valid.
const require = createRequire(typeof __filename === 'string' ? __filename : import.meta.url);
let sea = null;
try {
  sea = require('node:sea');
} catch {
  // Node versions without SEA support use adjacent source assets.
}

/** Read a JSON asset from Node SEA when embedded, or from source beside a module. */
export function readJsonAsset(assetName, adjacentPath) {
  try {
    if (sea?.isSea?.()) return JSON.parse(sea.getAsset(assetName, 'utf8'));
  } catch {
    // A malformed/missing SEA asset is a packaging error; source mode remains useful.
  }
  return JSON.parse(readFileSync(adjacentPath, 'utf8'));
}

export function isSeaRuntime() {
  return Boolean(sea?.isSea?.());
}
