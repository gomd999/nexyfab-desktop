import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// SMTP/MIME base64 expands attachments by roughly 4/3. An 18 MiB aggregate
// stays near 24 MiB before the small MIME headers, fitting the common 25 MiB
// transport class without advertising an undeliverable 100 MiB contract.
export const SEND_MAIL_MAX_ATTACHMENT_COUNT = 10;
export const SEND_MAIL_MAX_ATTACHMENT_BYTES = 18 * 1024 * 1024;
export const SEND_MAIL_MAX_TOTAL_ATTACHMENT_BYTES = 18 * 1024 * 1024;
export const SEND_MAIL_MAX_MULTIPART_BODY_BYTES = 20 * 1024 * 1024;

const DEFAULT_SPOOL_ROOT = path.resolve(process.cwd(), 'data', 'private-tmp', 'send-mail');

function canonicalPath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isStrictDescendant(root: string, candidate: string): boolean {
  const relative = path.relative(canonicalPath(root), canonicalPath(candidate));
  return relative.length > 0 && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function assertRootHasNoRealpathEscape(resolvedRoot: string, realRoot: string): void {
  if (canonicalPath(resolvedRoot) !== canonicalPath(realRoot)) {
    throw new Error('unsafe spool root');
  }
}

export function createPrivateSpoolDirectory(spoolRoot = DEFAULT_SPOOL_ROOT): string {
  const resolvedRoot = path.resolve(spoolRoot);
  fs.mkdirSync(resolvedRoot, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(resolvedRoot).isSymbolicLink()) throw new Error('unsafe spool root');
  fs.chmodSync(resolvedRoot, 0o700);
  const realRoot = fs.realpathSync(resolvedRoot);
  assertRootHasNoRealpathEscape(resolvedRoot, realRoot);

  const requestDir = path.join(realRoot, crypto.randomUUID());
  if (!isStrictDescendant(realRoot, requestDir)) throw new Error('unsafe spool directory');
  fs.mkdirSync(requestDir, { recursive: false, mode: 0o700 });
  if (fs.lstatSync(requestDir).isSymbolicLink()) throw new Error('unsafe spool directory');
  fs.chmodSync(requestDir, 0o700);
  const realRequestDir = fs.realpathSync(requestDir);
  if (!isStrictDescendant(realRoot, realRequestDir)) throw new Error('unsafe spool directory');
  return realRequestDir;
}

export async function spoolAttachmentFile(
  file: File,
  requestDir: string,
  spoolRoot = DEFAULT_SPOOL_ROOT,
): Promise<{ path: string; bytes: number }> {
  const resolvedRoot = path.resolve(spoolRoot);
  const realRoot = fs.realpathSync(resolvedRoot);
  assertRootHasNoRealpathEscape(resolvedRoot, realRoot);
  const realRequestDir = fs.realpathSync(path.resolve(requestDir));
  if (!isStrictDescendant(realRoot, realRequestDir) || fs.lstatSync(realRequestDir).isSymbolicLink()) {
    throw new Error('unsafe spool directory');
  }

  const filePath = path.join(realRequestDir, crypto.randomUUID());
  if (!isStrictDescendant(realRequestDir, filePath)) throw new Error('unsafe spool path');
  let bytes = 0;
  const countBytes = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.byteLength;
      if (bytes > file.size || bytes > SEND_MAIL_MAX_ATTACHMENT_BYTES) {
        callback(new Error('attachment byte count exceeded'));
        return;
      }
      callback(null, chunk);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(file.stream() as unknown as import('node:stream/web').ReadableStream<Uint8Array>),
      countBytes,
      fs.createWriteStream(filePath, { flags: 'wx', mode: 0o600 }),
    );
    if (bytes !== file.size) throw new Error('attachment byte count mismatch');
    fs.chmodSync(filePath, 0o600);
    return { path: filePath, bytes };
  } catch (error) {
    await fs.promises.unlink(filePath).catch(() => undefined);
    throw error;
  }
}

export async function cleanupPrivateSpoolDirectory(
  requestDir: string,
  spoolRoot = DEFAULT_SPOOL_ROOT,
): Promise<void> {
  const resolvedRoot = path.resolve(spoolRoot);
  const realRoot = await fs.promises.realpath(resolvedRoot).catch(() => null);
  if (!realRoot || canonicalPath(realRoot) !== canonicalPath(resolvedRoot)) return;

  const resolvedDir = path.resolve(requestDir);
  if (!isStrictDescendant(realRoot, resolvedDir)) return;
  const stat = await fs.promises.lstat(resolvedDir).catch(() => null);
  if (!stat) return;
  if (stat.isSymbolicLink()) {
    await fs.promises.unlink(resolvedDir).catch(() => undefined);
    return;
  }

  const realDir = await fs.promises.realpath(resolvedDir).catch(() => null);
  if (!realDir || !isStrictDescendant(realRoot, realDir)) return;
  await fs.promises.rm(realDir, { recursive: true, force: true });
}
