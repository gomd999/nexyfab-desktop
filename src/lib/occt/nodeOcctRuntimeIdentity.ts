import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from 'node:fs';
import path from 'node:path';

export const NODE_OCCT_RUNTIME_IDENTITY_SCHEMA = 'nexyfab.precision-cad.node-occt-runtime-identity.v1' as const;

export interface NodeOcctRuntimeIdentity {
  schema: typeof NODE_OCCT_RUNTIME_IDENTITY_SCHEMA;
  packageName: 'opencascade.js';
  packageVersion: string;
  nodeRuntimeVersion: string;
  v8Version: string;
  platform: NodeJS.Platform;
  arch: string;
  glueSha256: string;
  wasmSha256: string;
  packageManifestSha256: string;
  glueBytes: number;
  wasmBytes: number;
  runtimeIdentitySha256: string;
}

export interface NodeOcctRuntimeSnapshot {
  identity: NodeOcctRuntimeIdentity;
  gluePath: string;
  wasmPath: string;
  packageManifestPath: string;
  glueSource: Buffer;
  wasmBinary: Buffer;
}

const MIN_GLUE_BYTES = 1024;
const MIN_WASM_BYTES = 1024 * 1024;
const MAX_GLUE_BYTES = 8 * 1024 * 1024;
const MAX_WASM_BYTES = 256 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const PACKAGE_VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/;
const HASH_DOMAIN = 'nexyfab.precision-cad.node-occt-runtime-identity.sha256.v1';

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function readStableRegularFile(file: string, minimum: number, maximum: number): { realPath: string; bytes: Buffer } {
  const lexical = path.resolve(file);
  const link = lstatSync(lexical, { bigint: true });
  if (!link.isFile() || link.isSymbolicLink()) throw new Error('OCCT_RUNTIME_ASSET_NOT_REGULAR');
  const realPath = realpathSync(lexical);
  const descriptor = openSync(lexical, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || before.dev !== link.dev || before.ino !== link.ino
      || before.size < BigInt(minimum) || before.size > BigInt(maximum)
      || before.size > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('OCCT_RUNTIME_ASSET_SIZE_INVALID');
    const size = Number(before.size);
    const bytes = Buffer.allocUnsafe(size);
    let offset = 0;
    while (offset < size) {
      const count = readSync(descriptor, bytes, offset, size - offset, null);
      if (count <= 0) throw new Error('OCCT_RUNTIME_ASSET_CHANGED_DURING_READ');
      offset += count;
    }
    const overflowProbe = Buffer.allocUnsafe(1);
    if (readSync(descriptor, overflowProbe, 0, 1, null) !== 0) throw new Error('OCCT_RUNTIME_ASSET_CHANGED_DURING_READ');
    const after = fstatSync(descriptor, { bigint: true });
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size
      || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs) {
      throw new Error('OCCT_RUNTIME_ASSET_CHANGED_DURING_READ');
    }
    return { realPath, bytes };
  } finally {
    closeSync(descriptor);
  }
}

function packageVersion(bytes: Buffer): string {
  let parsed: unknown;
  try { parsed = JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error('OCCT_RUNTIME_PACKAGE_MANIFEST_INVALID'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('OCCT_RUNTIME_PACKAGE_MANIFEST_INVALID');
  const manifest = parsed as Record<string, unknown>;
  if (manifest.name !== 'opencascade.js' || typeof manifest.version !== 'string' || !PACKAGE_VERSION.test(manifest.version)) {
    throw new Error('OCCT_RUNTIME_PACKAGE_IDENTITY_INVALID');
  }
  return manifest.version;
}

/** Reads the exact WASM bytes later handed to Emscripten and binds all loader assets. */
export function readNodeOcctRuntimeSnapshot(distDir: string): NodeOcctRuntimeSnapshot {
  const absoluteDist = path.resolve(distDir);
  const glue = readStableRegularFile(path.join(absoluteDist, 'opencascade.wasm.js'), MIN_GLUE_BYTES, MAX_GLUE_BYTES);
  const wasm = readStableRegularFile(path.join(absoluteDist, 'opencascade.wasm.wasm'), MIN_WASM_BYTES, MAX_WASM_BYTES);
  const manifest = readStableRegularFile(path.join(absoluteDist, '..', 'package.json'), 2, MAX_MANIFEST_BYTES);
  const version = packageVersion(manifest.bytes);
  const unsigned = {
    schema: NODE_OCCT_RUNTIME_IDENTITY_SCHEMA,
    packageName: 'opencascade.js' as const,
    packageVersion: version,
    nodeRuntimeVersion: process.versions.node,
    v8Version: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
    glueSha256: sha256(glue.bytes),
    wasmSha256: sha256(wasm.bytes),
    packageManifestSha256: sha256(manifest.bytes),
    glueBytes: glue.bytes.length,
    wasmBytes: wasm.bytes.length,
  };
  const runtimeIdentitySha256 = sha256(`${HASH_DOMAIN}\n${JSON.stringify(unsigned)}`);
  return Object.freeze({
    identity: Object.freeze({ ...unsigned, runtimeIdentitySha256 }),
    gluePath: glue.realPath,
    wasmPath: wasm.realPath,
    packageManifestPath: manifest.realPath,
    glueSource: glue.bytes,
    wasmBinary: wasm.bytes,
  });
}

/** Detects a glue/manifest swap across dynamic import; WASM identity binds the in-memory bytes directly. */
export function assertNodeOcctRuntimeSnapshotUnchanged(snapshot: NodeOcctRuntimeSnapshot): void {
  const manifest = readStableRegularFile(snapshot.packageManifestPath, 2, MAX_MANIFEST_BYTES);
  if (sha256(snapshot.glueSource) !== snapshot.identity.glueSha256
    || sha256(snapshot.wasmBinary) !== snapshot.identity.wasmSha256
    || sha256(manifest.bytes) !== snapshot.identity.packageManifestSha256
    || packageVersion(manifest.bytes) !== snapshot.identity.packageVersion) {
    throw new Error('OCCT_RUNTIME_ASSET_CHANGED_DURING_LOAD');
  }
}
