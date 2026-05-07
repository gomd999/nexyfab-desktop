/**
 * ESM shim for load-parent-env.cjs — allows `.mjs` scripts to load parent .env
 * by importing this file. The real logic lives in load-parent-env.cjs so that
 * next.config.ts (CJS) can also require it.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { loadParentEnv } = require('./load-parent-env.cjs');
export { loadParentEnv };
