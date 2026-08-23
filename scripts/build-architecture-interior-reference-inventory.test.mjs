import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildInventory, parseArgs, writeInventory } from './build-architecture-interior-reference-inventory.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexyfab-arch-int-'));
  const source = path.join(root, 'source');
  fs.mkdirSync(path.join(source, 'nested'), { recursive: true });
  fs.writeFileSync(path.join(source, 'model.ifc'), 'IFC-DATA\n');
  fs.writeFileSync(path.join(source, 'nested', 'layout.json'), '{"revision":1}\n');
  return { root, source };
}

test('builds a deterministic alias/relative-path inventory without absolute paths', () => {
  const first = fixture();
  const second = fixture();
  fs.writeFileSync(path.join(second.source, 'model.ifc'), 'IFC-DATA\n');
  fs.writeFileSync(path.join(second.source, 'nested', 'layout.json'), '{"revision":1}\n');
  const a = buildInventory({ sources: [{ alias: 'sample', root: first.source }], out: path.join(first.root, 'inventory.json') });
  const b = buildInventory({ sources: [{ alias: 'sample', root: second.source }], out: path.join(second.root, 'inventory.json') });
  assert.deepEqual(a, b);
  assert.equal(a.counts.files, 2);
  assert.equal(a.files[0].alias, 'sample');
  assert.equal(a.files[0].path, 'model.ifc');
  assert.equal(a.files.some(item => JSON.stringify(item).includes(first.root)), false);
  assert.equal(a.files.some(item => JSON.stringify(item).includes(second.root)), false);
  assert.equal(a.files[0].extension, '.ifc');
  assert.match(a.rootSha256, /^[a-f0-9]{64}$/);
});

test('parses repeated absolute source aliases and writes only the manifest payload', () => {
  const { root, source } = fixture();
  const secondSource = path.join(root, 'source-2');
  fs.mkdirSync(secondSource, { recursive: true });
  fs.writeFileSync(path.join(secondSource, 'finish.json'), '{"finishCode":"F-1"}\n');
  const out = path.join(root, 'out', 'reference.json');
  const parsed = parseArgs(['--source', `arch=${source}`, '--source', `interior=${secondSource}`, '--out', out]);
  assert.equal(parsed.sources.length, 2);
  const inventory = buildInventory(parsed);
  writeInventory(inventory, out);
  const stored = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.deepEqual(stored, inventory);
  assert.equal(JSON.stringify(stored).includes(source), false);
});

test('fails closed for duplicate aliases, duplicate paths and path traversal', () => {
  const { root, source } = fixture();
  assert.throws(() => parseArgs(['--source', `arch=${source}`, '--source', `arch=${source}`, '--out', path.join(root, 'out.json')]), /SOURCE_ALIAS_DUPLICATE/);
  assert.throws(() => buildInventory({ sources: [{ alias: 'arch', root: source }, { alias: 'arch', root: source }], out: path.join(root, 'out.json') }), /SOURCE_ALIAS_DUPLICATE/);
  assert.throws(() => buildInventory({ sources: [{ alias: 'arch', root: source }, { alias: 'interior', root: source }], out: path.join(root, 'out.json') }), /SOURCE_PATH_DUPLICATE/);
  assert.throws(() => parseArgs(['--source', `../arch=${source}`, '--out', path.join(root, 'out.json')]), /SOURCE_ALIAS_INVALID/);
  assert.throws(() => parseArgs(['--source', 'arch=relative/source', '--out', path.join(root, 'out.json')]), /SOURCE_PATH_NOT_ABSOLUTE/);
  assert.throws(() => parseArgs(['--source', `arch=${source}`, '--out', 'relative/out.json']), /PATH_NOT_ABSOLUTE/);
});

test('fails closed when output would be scanned or source cannot be read', () => {
  const { root } = fixture();
  assert.throws(() => buildInventory({ sources: [{ alias: 'arch', root }], out: path.join(root, 'inventory.json') }), /OUTPUT_SELF_INCLUSION/);
  assert.throws(() => buildInventory({ sources: [{ alias: 'arch', root: path.join(root, 'missing') }], out: path.join(os.tmpdir(), 'inventory.json') }), /SOURCE_UNREADABLE/);
});

test('rejects symlink entries instead of following them', t => {
  const { root, source } = fixture();
  const target = path.join(root, 'outside.txt');
  fs.writeFileSync(target, 'outside');
  const link = path.join(source, 'escape.txt');
  try { fs.symlinkSync(target, link, 'file'); } catch { t.skip('symlink creation is unavailable in this environment'); return; }
  assert.throws(() => buildInventory({ sources: [{ alias: 'arch', root: source }], out: path.join(root, 'inventory.json') }), /SYMLINK_NOT_ALLOWED/);
});
