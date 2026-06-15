/**
 * compute-occt-sri — unit tests for the Phase 5 launch step 10 SRI generator.
 *
 * Same DI strategy as `copy-occt.test.ts`: never touch the real fs. We pass
 * a fake `fs` and a deterministic `hashFn` so the test runs in microseconds
 * and is robust to repo state.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import * as path from 'node:path';

const req = createRequire(import.meta.url);

interface SriResult {
  wrote: boolean;
  sri: Record<string, string>;
  warnings: string[];
  outPath: string;
}

const script = req('./compute-occt-sri.js') as {
  computeOcctSri: (opts: {
    root?: string;
    fs?: FakeFs;
    hashFn?: (buf: Buffer) => string;
  }) => SriResult;
  SRC_REL: string;
  OUT_REL: string;
  TARGETS: Array<{ rel: string; key: string }>;
};

const { computeOcctSri, SRC_REL, OUT_REL, TARGETS } = script;

const ROOT = path.resolve('/fake-repo-root');

interface FakeFs {
  existsSync(p: string): boolean;
  readFileSync(p: string): Buffer;
  mkdirSync(p: string, opts?: { recursive?: boolean }): void;
  writeFileSync(p: string, data: string | Buffer): void;
  __writes: Array<{ path: string; data: string }>;
  __throwOnRead?: boolean;
  __throwOnWrite?: boolean;
  __throwOnExists?: boolean;
}

function makeFs(initial: Record<string, Buffer | string>, opts: Partial<FakeFs> = {}): FakeFs {
  const present = new Map<string, Buffer>();
  for (const [rel, val] of Object.entries(initial)) {
    const abs = path.join(ROOT, rel);
    const buf = typeof val === 'string' ? Buffer.from(val) : val;
    present.set(abs, buf);
    // mark parent dirs as "present" (we treat dir membership via Map.has check on prefix)
  }

  const fs: FakeFs = {
    __writes: [],
    __throwOnRead: opts.__throwOnRead,
    __throwOnWrite: opts.__throwOnWrite,
    __throwOnExists: opts.__throwOnExists,
    existsSync(p: string): boolean {
      if (fs.__throwOnExists) throw new Error('boom existsSync');
      return present.has(p);
    },
    readFileSync(p: string): Buffer {
      if (fs.__throwOnRead) throw new Error('EIO: read failed');
      const v = present.get(p);
      if (v == null) throw new Error('ENOENT: ' + p);
      return v;
    },
    mkdirSync(_p: string, _opts?: { recursive?: boolean }): void {
      // no-op; we don't track this for the SRI script (the parent always
      // exists if the source file did).
    },
    writeFileSync(p: string, data: string | Buffer): void {
      if (fs.__throwOnWrite) throw new Error('EACCES: write failed');
      const s = typeof data === 'string' ? data : data.toString('utf8');
      fs.__writes.push({ path: p, data: s });
      present.set(p, Buffer.from(s));
    },
  };
  return fs;
}

/** Deterministic hash so tests don't depend on `node:crypto` internals. */
function fakeHash(buf: Buffer): string {
  // Identifies inputs uniquely while being short enough to read in failure logs.
  return Buffer.from('test-' + buf.length).toString('base64');
}

describe('computeOcctSri', () => {
  it('hashes opencascade.js into sri.json with sha384- prefix', () => {
    const fs = makeFs({
      [SRC_REL]: 'console.log("opencascade loader stand-in");',
    });
    const out = computeOcctSri({ root: ROOT, fs, hashFn: fakeHash });

    expect(out.wrote).toBe(true);
    expect(out.sri['opencascade.js']).toMatch(/^sha384-/);
    expect(out.warnings).toEqual([]);
  });

  it('writes JSON payload to public/occt-worker/sri.json with algorithm + files', () => {
    const fs = makeFs({
      [SRC_REL]: 'hello world',
    });
    computeOcctSri({ root: ROOT, fs, hashFn: fakeHash });

    expect(fs.__writes.length).toBe(1);
    const write = fs.__writes[0];
    expect(write.path).toBe(path.join(ROOT, OUT_REL));

    const parsed = JSON.parse(write.data);
    expect(parsed.algorithm).toBe('sha384');
    expect(parsed.files['opencascade.js']).toMatch(/^sha384-/);
    expect(typeof parsed.generatedAt).toBe('string');
  });

  it('graceful skip when the source file is missing (Phase 4 build)', () => {
    const fs = makeFs({}); // no source
    const out = computeOcctSri({ root: ROOT, fs, hashFn: fakeHash });

    expect(out.wrote).toBe(false);
    expect(out.sri).toEqual({});
    expect(out.warnings.length).toBe(1);
    expect(out.warnings[0]).toContain('source file missing');
  });

  it('does not write sri.json when nothing was hashed (preserves prior file)', () => {
    const fs = makeFs({});
    computeOcctSri({ root: ROOT, fs, hashFn: fakeHash });
    expect(fs.__writes).toEqual([]);
  });

  it('warns and skips when readFileSync throws (corrupted install)', () => {
    const fs = makeFs(
      { [SRC_REL]: 'loader' },
      { __throwOnRead: true },
    );
    const out = computeOcctSri({ root: ROOT, fs, hashFn: fakeHash });
    expect(out.wrote).toBe(false);
    expect(out.warnings.some((w) => w.includes('failed to read'))).toBe(true);
  });

  it('warns when writeFileSync throws but does not crash', () => {
    const fs = makeFs(
      { [SRC_REL]: 'loader' },
      { __throwOnWrite: true },
    );
    const out = computeOcctSri({ root: ROOT, fs, hashFn: fakeHash });
    expect(out.wrote).toBe(false);
    expect(out.warnings.some((w) => w.includes('failed to write'))).toBe(true);
  });

  it('tolerates an existsSync that throws (treats as missing)', () => {
    const fs = makeFs(
      { [SRC_REL]: 'loader' },
      { __throwOnExists: true },
    );
    const out = computeOcctSri({ root: ROOT, fs, hashFn: fakeHash });
    expect(out.wrote).toBe(false);
    expect(out.warnings[0]).toContain('source file missing');
  });

  it('uses the injected hashFn deterministically', () => {
    const fs = makeFs({
      [SRC_REL]: 'a'.repeat(123),
    });
    const out = computeOcctSri({ root: ROOT, fs, hashFn: fakeHash });
    // fakeHash → base64('test-' + length)
    const expected = 'sha384-' + Buffer.from('test-123').toString('base64');
    expect(out.sri['opencascade.js']).toBe(expected);
  });

  it('exposes SRC_REL / OUT_REL with the expected paths', () => {
    expect(SRC_REL).toBe(path.join('public', 'occt-worker', 'opencascade.js'));
    expect(OUT_REL).toBe(path.join('public', 'occt-worker', 'sri.json'));
  });

  it('TARGETS contract — opencascade.js is the only target today', () => {
    expect(TARGETS).toHaveLength(1);
    expect(TARGETS[0].key).toBe('opencascade.js');
    expect(TARGETS[0].rel).toBe(SRC_REL);
  });

  it('default node:crypto hashFn (no injection) produces a stable sha384 digest', () => {
    // This is the only test that exercises the real crypto path. We pass a
    // tiny fixed buffer and assert the well-known SHA-384 base64 of "hello".
    const fs = makeFs({ [SRC_REL]: 'hello' });
    const out = computeOcctSri({ root: ROOT, fs }); // no hashFn → defaults to sha384
    // SHA-384 of "hello", base64:
    expect(out.sri['opencascade.js']).toBe(
      'sha384-WeF0h3dEjGnea4ANejO7+5/xtGPkQ1TDVTvNucZm+pASWjx5+QOXvfX2oT3oKGhP',
    );
  });
});
