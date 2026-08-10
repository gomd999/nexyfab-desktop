import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { extractAppRouteBundle, parseClientReferenceManifest } from './app-route-bundle-manifest.mjs';

test('parses a Next 16 client reference manifest without evaluating code', () => {
  const source = 'globalThis.__RSC_MANIFEST=(globalThis.__RSC_MANIFEST||{});globalThis.__RSC_MANIFEST["/[lang]/design/page"]={"clientModules":{},"entryCSSFiles":{}};';
  const result = parseClientReferenceManifest(source);
  assert.equal(result.route, '/[lang]/design/page');
  assert.deepEqual(result.manifest.clientModules, {});
});

test('collects the page entry dependencies and ancestor CSS with encoded route segments', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nf-app-bundle-'));
  try {
    const files = {
      'static/chunks/vendor.js': 'vendor',
      'static/chunks/app/[lang]/design/page-a.js': 'page',
      'static/css/root.css': 'root',
      'static/css/page.css': 'page-css',
    };
    for (const [relative, content] of Object.entries(files)) {
      const absolute = path.join(temp, relative);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, content);
    }
    const manifest = {
      clientModules: {
        page: { chunks: ['1', 'static/chunks/vendor.js', '2', 'static/chunks/app/%5Blang%5D/design/page-a.js'] },
        unrelated: { chunks: ['static/chunks/app/admin/page-z.js'] },
      },
      entryCSSFiles: {
        'C:\\repo\\src\\app\\layout': [{ path: 'static/css/root.css' }],
        'C:\\repo\\src\\app\\[lang]\\design\\page': [{ path: 'static/css/page.css' }],
        'C:\\repo\\src\\app\\admin\\layout': [{ path: 'static/css/admin.css' }],
      },
    };
    const source = `globalThis.__RSC_MANIFEST["/[lang]/design/page"]=${JSON.stringify(manifest)};`;
    const result = extractAppRouteBundle(temp, source);
    assert.equal(result.route, '/[lang]/design');
    assert.equal(result.measured, true);
    assert.deepEqual(result.initialJsFiles, ['static/chunks/app/%5Blang%5D/design/page-a.js', 'static/chunks/vendor.js']);
    assert.deepEqual(result.cssFiles, ['static/css/page.css', 'static/css/root.css']);
    assert.equal(result.initialJsBytes, 'page'.length + 'vendor'.length);
  } finally {
    const resolvedTemp = path.resolve(temp);
    assert.equal(path.dirname(resolvedTemp), path.resolve(os.tmpdir()));
    assert.match(path.basename(resolvedTemp), /^nf-app-bundle-/);
    fs.rmSync(resolvedTemp, { recursive: true, force: true });
  }
});
