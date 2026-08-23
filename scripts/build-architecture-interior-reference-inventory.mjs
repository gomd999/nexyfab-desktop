#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const INVENTORY_SCHEMA = 'nexyfab.architecture-interior.reference-inventory.v1';
const ALIAS = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const SHA256 = /^[a-f0-9]{64}$/;

function fail(code, detail = '') {
  const error = new Error(detail ? `${code}:${detail}` : code);
  error.code = code;
  throw error;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sha256File(filePath, expectedStats, relative) {
  let descriptor;
  try {
    descriptor = fs.openSync(filePath, 'r');
    const before = fs.fstatSync(descriptor);
    if (!before.isFile() || before.size !== expectedStats.size || before.mtimeMs !== expectedStats.mtimeMs) fail('FILE_CHANGED_DURING_READ', relative);
    const digest = createHash('sha256');
    const buffer = Buffer.allocUnsafe(4 * 1024 * 1024);
    let offset = 0;
    while (offset < before.size) {
      const read = fs.readSync(descriptor, buffer, 0, Math.min(buffer.length, before.size - offset), offset);
      if (read <= 0) fail('FILE_READ_TRUNCATED', relative);
      digest.update(buffer.subarray(0, read));
      offset += read;
    }
    const after = fs.fstatSync(descriptor);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) fail('FILE_CHANGED_DURING_READ', relative);
    return digest.digest('hex');
  } catch (error) {
    if (error?.code && String(error.code).startsWith('FILE_')) throw error;
    fail('FILE_UNREADABLE', relative);
  } finally {
    if (descriptor !== undefined) try { fs.closeSync(descriptor); } catch { /* best-effort close */ }
  }
}

function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}

function posixRelative(value) {
  return value.split(path.sep).join('/').replace(/^\.\//, '');
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function canonicalPath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) fail('PATH_NOT_ABSOLUTE');
  const absolute = path.resolve(value);
  return absolute;
}

function parseSource(value) {
  const separator = value.indexOf('=');
  if (separator <= 0 || separator === value.length - 1) fail('SOURCE_ARGUMENT_INVALID', value);
  const alias = value.slice(0, separator);
  const root = value.slice(separator + 1);
  if (!ALIAS.test(alias)) fail('SOURCE_ALIAS_INVALID', alias);
  if (!path.isAbsolute(root)) fail('SOURCE_PATH_NOT_ABSOLUTE', alias);
  return { alias, root: canonicalPath(root) };
}

export function parseArgs(args = []) {
  const sources = [];
  let out;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--source') {
      if (!args[index + 1]) fail('SOURCE_ARGUMENT_MISSING');
      sources.push(parseSource(args[++index]));
    } else if (arg === '--out') {
      if (!args[index + 1]) fail('OUT_ARGUMENT_MISSING');
      out = canonicalPath(args[++index]);
    } else if (arg === '--help' || arg === '-h') {
      return { help: true, sources: [], out: undefined };
    } else {
      fail('ARGUMENT_UNKNOWN', arg);
    }
  }
  if (!sources.length) fail('SOURCE_REQUIRED');
  if (!out) fail('OUT_REQUIRED');
  const aliases = new Set();
  for (const source of sources) {
    if (aliases.has(source.alias)) fail('SOURCE_ALIAS_DUPLICATE', source.alias);
    aliases.add(source.alias);
  }
  return { help: false, sources, out };
}

function sourceRealPath(source) {
  let stats;
  try { stats = fs.lstatSync(source.root); } catch { fail('SOURCE_UNREADABLE', source.alias); }
  if (stats.isSymbolicLink()) fail('SOURCE_SYMLINK_NOT_ALLOWED', source.alias);
  try { return fs.realpathSync.native(source.root); } catch { fail('SOURCE_UNREADABLE', source.alias); }
}

function inventorySource(source, outputPath, seenPaths, rows) {
  const sourceRoot = sourceRealPath(source);
  let rootStats;
  try { rootStats = fs.lstatSync(source.root); } catch { fail('SOURCE_UNREADABLE', source.alias); }
  const walk = (candidate, relativeBase) => {
    let stats;
    try { stats = fs.lstatSync(candidate); } catch { fail('FILE_UNREADABLE', posixRelative(relativeBase || path.basename(candidate))); }
    if (stats.isSymbolicLink()) fail('SYMLINK_NOT_ALLOWED', posixRelative(relativeBase));
    let real;
    try { real = fs.realpathSync.native(candidate); } catch { fail('FILE_UNREADABLE', posixRelative(relativeBase)); }
    if (!isWithin(sourceRoot, real)) fail('PATH_ESCAPE', posixRelative(relativeBase));
    if (outputPath && path.resolve(candidate) === outputPath) fail('OUTPUT_SELF_INCLUSION', source.alias);
    if (stats.isDirectory()) {
      let entries;
      try { entries = fs.readdirSync(candidate, { withFileTypes: true }); } catch { fail('DIRECTORY_UNREADABLE', posixRelative(relativeBase)); }
      entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
        for (const entry of entries) walk(path.join(candidate, entry.name), path.join(relativeBase, entry.name));
      return;
    }
    if (!stats.isFile()) fail('FILE_TYPE_UNSUPPORTED', posixRelative(relativeBase));
    const normalizedReal = process.platform === 'win32' ? real.toLowerCase() : real;
    if (seenPaths.has(normalizedReal)) fail('SOURCE_PATH_DUPLICATE', posixRelative(relativeBase));
    seenPaths.add(normalizedReal);
    const relative = posixRelative(relativeBase);
    if (!relative || relative === '.' || relative.startsWith('../') || relative.includes('/../')) fail('RELATIVE_PATH_INVALID', relative);
    const extension = path.extname(relative).toLowerCase();
    rows.push({ alias: source.alias, path: relative, sha256: sha256File(candidate, stats, relative), bytes: stats.size, extension });
  };
  walk(source.root, rootStats.isDirectory() ? '' : path.basename(source.root));
}

export function buildInventory({ sources, out } = {}) {
  if (!Array.isArray(sources) || sources.length === 0) fail('SOURCE_REQUIRED');
  const outputPath = out ? canonicalPath(out) : undefined;
  const rows = [];
  const seenPaths = new Set();
  const aliases = new Set();
  for (const source of sources) {
    if (!source || typeof source.alias !== 'string' || !ALIAS.test(source.alias) || typeof source.root !== 'string' || !path.isAbsolute(source.root)) fail('SOURCE_ARGUMENT_INVALID');
    if (aliases.has(source.alias)) fail('SOURCE_ALIAS_DUPLICATE', source.alias);
    aliases.add(source.alias);
    const root = canonicalPath(source.root);
    if (outputPath && isWithin(root, outputPath)) fail('OUTPUT_SELF_INCLUSION', source.alias);
    const before = rows.length;
    inventorySource({ alias: source.alias, root }, outputPath, seenPaths, rows);
    if (rows.length === before) fail('SOURCE_EMPTY', source.alias);
  }
  rows.sort((left, right) => left.alias.localeCompare(right.alias, 'en') || left.path.localeCompare(right.path, 'en'));
  const extensions = {};
  for (const row of rows) extensions[row.extension] = (extensions[row.extension] ?? 0) + 1;
  const counts = { sources: sources.length, files: rows.length, bytes: rows.reduce((sum, row) => sum + row.bytes, 0), extensions };
  const rootSha256 = sha256(Buffer.from(stable({ schema: INVENTORY_SCHEMA, files: rows, counts }), 'utf8'));
  if (!SHA256.test(rootSha256)) fail('ROOT_HASH_INVALID');
  return { schema: INVENTORY_SCHEMA, files: rows, counts, rootSha256 };
}

export function writeInventory(inventory, out) {
  if (!inventory || inventory.schema !== INVENTORY_SCHEMA || !SHA256.test(inventory.rootSha256)) fail('INVENTORY_INVALID');
  const outputPath = canonicalPath(out);
  try { fs.mkdirSync(path.dirname(outputPath), { recursive: true }); } catch { fail('OUT_DIRECTORY_UNWRITABLE'); }
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(inventory, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temporaryPath, outputPath);
  } catch {
    try { fs.rmSync(temporaryPath, { force: true }); } catch { /* best-effort cleanup */ }
    fail('OUT_UNWRITABLE');
  }
  return outputPath;
}

export function main(args = process.argv.slice(2)) {
  try {
    const parsed = parseArgs(args);
    if (parsed.help) {
      process.stdout.write('Usage: node scripts/build-architecture-interior-reference-inventory.mjs --source alias=ABSOLUTE_PATH [--source alias=ABSOLUTE_PATH ...] --out ABSOLUTE_PATH\n');
      return 0;
    }
    const inventory = buildInventory(parsed);
    writeInventory(inventory, parsed.out);
    process.stdout.write(`${JSON.stringify({ ok: true, files: inventory.counts.files, rootSha256: inventory.rootSha256 })}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`[architecture-interior-reference-inventory] ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) process.exitCode = main();
