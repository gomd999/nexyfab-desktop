/**
 * copy-occt — unit tests for the Phase 5 launch step 1 copy script.
 *
 * Strategy: identical pattern to `check-occt-readiness.test.ts`. We never
 * touch the real filesystem — each test builds an in-memory fake fs
 * (Map<absolutePath, size>) and injects it into `copyOcct({ fs })`.
 *
 * The script is plain CommonJS (.js) so we use `createRequire` to load it
 * from this .ts test without a tsconfig hop.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import * as path from 'node:path';

const req = createRequire(import.meta.url);

interface CopyResult {
  copied: string[];
  skipped: string[];
  warnings: string[];
  srcDir: string;
  dstDir: string;
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const script = req('./copy-occt.js') as {
  copyOcct: (opts: { root?: string; fs?: FakeFs }) => CopyResult;
  copyWorkerScripts: (opts: { root?: string; fs?: FakeFs }) => CopyResult;
  SRC_DIR_REL: string;
  DST_DIR_REL: string;
  WORKER_SRC_DIR_REL: string;
  FILES: Array<{ src: string; dst: string }>;
  WORKER_FILES: string[];
};

const { copyOcct, copyWorkerScripts, SRC_DIR_REL, DST_DIR_REL, WORKER_SRC_DIR_REL, FILES, WORKER_FILES } = script;

const ROOT = path.resolve('/fake-repo-root');

/**
 * Minimum fake fs surface used by `copy-occt.js`. We track:
 *   - which paths exist (and their size, for the readiness sibling check)
 *   - which mkdirSync calls happened (so we can assert mkdir-p semantics)
 *   - which copyFileSync calls happened (so we can assert source→dest pairs)
 *
 * Errors are simulated by setting `throwOn*` flags.
 */
interface FakeFs {
  existsSync(p: string): boolean;
  mkdirSync(p: string, opts?: { recursive?: boolean }): void;
  copyFileSync(src: string, dst: string): void;
  __mkdirs: string[];
  __copies: Array<{ src: string; dst: string }>;
  __throwOnMkdir?: boolean;
  __throwOnCopy?: string; // throws when src equals this
  __throwOnExists?: boolean;
}

/**
 * Build a fake fs from a {relativePath → size} map. The size is unused by
 * the copy script (the readiness script consumes it) but we accept it so the
 * test fixtures can match the readiness suite's vocabulary.
 *
 * After construction, additional files written via `copyFileSync` are added
 * with size 1 (placeholder — copy script doesn't read post-copy size).
 */
function makeFs(initial: Record<string, number>, opts: Partial<FakeFs> = {}): FakeFs {
  const present = new Set<string>();
  // Auto-create parent dirs of every initial file so the `existsSync(srcDir)`
  // short-circuit only triggers when the test really means "package missing".
  for (const [rel] of Object.entries(initial)) {
    const abs = path.join(ROOT, rel);
    present.add(abs);
    // Walk up the path, adding every directory so `existsSync(dist)` is true.
    let cur = path.dirname(abs);
    while (cur && cur !== path.dirname(cur)) {
      present.add(cur);
      cur = path.dirname(cur);
    }
  }

  const fs: FakeFs = {
    __mkdirs: [],
    __copies: [],
    __throwOnMkdir: opts.__throwOnMkdir,
    __throwOnCopy: opts.__throwOnCopy,
    __throwOnExists: opts.__throwOnExists,
    existsSync(p: string): boolean {
      if (fs.__throwOnExists) throw new Error('boom existsSync');
      return present.has(p);
    },
    mkdirSync(p: string, _opts?: { recursive?: boolean }): void {
      if (fs.__throwOnMkdir) {
        throw new Error('EACCES: permission denied');
      }
      fs.__mkdirs.push(p);
      present.add(p);
    },
    copyFileSync(src: string, dst: string): void {
      if (fs.__throwOnCopy && src.endsWith(fs.__throwOnCopy)) {
        throw new Error('EIO: copy failed');
      }
      fs.__copies.push({ src, dst });
      present.add(dst);
    },
  };
  return fs;
}

describe('copyOcct', () => {
  describe('happy path — both source files present', () => {
    it('copies opencascade.wasm.js → opencascade.js (drops inner .wasm)', () => {
      const fs = makeFs({
        [path.join(SRC_DIR_REL, 'opencascade.wasm.js')]: 330_000,
        [path.join(SRC_DIR_REL, 'opencascade.wasm.wasm')]: 65_000_000,
      });
      const out = copyOcct({ root: ROOT, fs });
      expect(out.copied).toContain('opencascade.js');
      expect(out.copied).toContain('opencascade.wasm');
      expect(out.warnings).toEqual([]);
      expect(out.skipped).toEqual([]);
    });

    it('creates public/occt-worker/ via mkdirSync with recursive:true', () => {
      const fs = makeFs({
        [path.join(SRC_DIR_REL, 'opencascade.wasm.js')]: 330_000,
        [path.join(SRC_DIR_REL, 'opencascade.wasm.wasm')]: 65_000_000,
      });
      copyOcct({ root: ROOT, fs });
      const expectedDst = path.join(ROOT, DST_DIR_REL);
      expect(fs.__mkdirs).toContain(expectedDst);
    });

    it('copy targets land under public/occt-worker/ with the renamed names', () => {
      const fs = makeFs({
        [path.join(SRC_DIR_REL, 'opencascade.wasm.js')]: 330_000,
        [path.join(SRC_DIR_REL, 'opencascade.wasm.wasm')]: 65_000_000,
      });
      copyOcct({ root: ROOT, fs });
      const dstDir = path.join(ROOT, DST_DIR_REL);
      const dsts = fs.__copies.map((c) => c.dst);
      expect(dsts).toContain(path.join(dstDir, 'opencascade.js'));
      expect(dsts).toContain(path.join(dstDir, 'opencascade.wasm'));
    });

    it('reads sources from node_modules/opencascade.js/dist/ with the original .wasm. names', () => {
      const fs = makeFs({
        [path.join(SRC_DIR_REL, 'opencascade.wasm.js')]: 330_000,
        [path.join(SRC_DIR_REL, 'opencascade.wasm.wasm')]: 65_000_000,
      });
      copyOcct({ root: ROOT, fs });
      const srcDir = path.join(ROOT, SRC_DIR_REL);
      const srcs = fs.__copies.map((c) => c.src);
      expect(srcs).toContain(path.join(srcDir, 'opencascade.wasm.js'));
      expect(srcs).toContain(path.join(srcDir, 'opencascade.wasm.wasm'));
    });
  });

  describe('graceful skip — package missing', () => {
    it('warns and skips both files when node_modules/opencascade.js/dist/ is missing', () => {
      const fs = makeFs({}); // no source files at all
      const out = copyOcct({ root: ROOT, fs });
      expect(out.copied).toEqual([]);
      expect(out.skipped).toEqual(['opencascade.js', 'opencascade.wasm']);
      expect(out.warnings.length).toBeGreaterThan(0);
      expect(out.warnings[0]).toContain('opencascade.js npm package not found');
    });

    it('does NOT attempt mkdirSync or copyFileSync when package is missing', () => {
      const fs = makeFs({});
      copyOcct({ root: ROOT, fs });
      expect(fs.__mkdirs).toEqual([]);
      expect(fs.__copies).toEqual([]);
    });
  });

  describe('partial / corrupted install', () => {
    it('warns per-file when one source is missing but dist dir exists', () => {
      // Only the .js file exists — .wasm file missing (corrupted install).
      const fs = makeFs({
        [path.join(SRC_DIR_REL, 'opencascade.wasm.js')]: 330_000,
        // sibling placeholder file just to ensure dist dir is "present"
        [path.join(SRC_DIR_REL, 'README.md')]: 100,
      });
      const out = copyOcct({ root: ROOT, fs });
      expect(out.copied).toContain('opencascade.js');
      expect(out.skipped).toContain('opencascade.wasm');
      expect(out.warnings.some((w) => w.includes('opencascade.wasm.wasm'))).toBe(true);
    });

    it('continues copying other files when one source file is missing', () => {
      // .wasm exists, .js missing — should still copy the .wasm one.
      const fs = makeFs({
        [path.join(SRC_DIR_REL, 'opencascade.wasm.wasm')]: 65_000_000,
        [path.join(SRC_DIR_REL, 'README.md')]: 100,
      });
      const out = copyOcct({ root: ROOT, fs });
      expect(out.copied).toContain('opencascade.wasm');
      expect(out.skipped).toContain('opencascade.js');
    });
  });

  describe('fs errors are non-fatal', () => {
    it('warns and skips all files when mkdirSync throws (permission denied)', () => {
      const fs = makeFs(
        {
          [path.join(SRC_DIR_REL, 'opencascade.wasm.js')]: 330_000,
          [path.join(SRC_DIR_REL, 'opencascade.wasm.wasm')]: 65_000_000,
        },
        { __throwOnMkdir: true },
      );
      const out = copyOcct({ root: ROOT, fs });
      expect(out.copied).toEqual([]);
      expect(out.skipped).toEqual(['opencascade.js', 'opencascade.wasm']);
      expect(out.warnings.some((w) => w.includes('failed to create destination dir'))).toBe(true);
    });

    it('warns per-file when copyFileSync throws but keeps going for the other file', () => {
      const fs = makeFs(
        {
          [path.join(SRC_DIR_REL, 'opencascade.wasm.js')]: 330_000,
          [path.join(SRC_DIR_REL, 'opencascade.wasm.wasm')]: 65_000_000,
        },
        { __throwOnCopy: 'opencascade.wasm.js' },
      );
      const out = copyOcct({ root: ROOT, fs });
      expect(out.copied).toEqual(['opencascade.wasm']);
      expect(out.skipped).toContain('opencascade.js');
      expect(out.warnings.some((w) => w.includes('copy failed for opencascade.wasm.js'))).toBe(true);
    });

    it('tolerates an existsSync that throws (treats as missing, no crash)', () => {
      const fs = makeFs(
        {
          [path.join(SRC_DIR_REL, 'opencascade.wasm.js')]: 330_000,
        },
        { __throwOnExists: true },
      );
      const out = copyOcct({ root: ROOT, fs });
      // existsSync(srcDir) throws → treated as missing → package-missing path
      expect(out.copied).toEqual([]);
      expect(out.warnings[0]).toContain('opencascade.js npm package not found');
    });
  });

  describe('contract / shape', () => {
    it('FILES manifest carries the exact rename map Phase 5 expects', () => {
      // Sanity: if anyone reorders these we want the test to scream.
      const map = Object.fromEntries(FILES.map((f) => [f.src, f.dst]));
      expect(map['opencascade.wasm.js']).toBe('opencascade.js');
      expect(map['opencascade.wasm.wasm']).toBe('opencascade.wasm');
      expect(FILES.length).toBe(2);
    });

    it('returns the resolved srcDir and dstDir so callers can log them', () => {
      const fs = makeFs({});
      const out = copyOcct({ root: ROOT, fs });
      expect(out.srcDir).toBe(path.join(ROOT, SRC_DIR_REL));
      expect(out.dstDir).toBe(path.join(ROOT, DST_DIR_REL));
    });

    it('warnings/copied/skipped are always arrays even on the happy path', () => {
      const fs = makeFs({
        [path.join(SRC_DIR_REL, 'opencascade.wasm.js')]: 330_000,
        [path.join(SRC_DIR_REL, 'opencascade.wasm.wasm')]: 65_000_000,
      });
      const out = copyOcct({ root: ROOT, fs });
      expect(Array.isArray(out.copied)).toBe(true);
      expect(Array.isArray(out.skipped)).toBe(true);
      expect(Array.isArray(out.warnings)).toBe(true);
    });
  });
});

describe('copyWorkerScripts', () => {
  const allWorkers = (): Record<string, number> =>
    Object.fromEntries(WORKER_FILES.map((n) => [path.join(WORKER_SRC_DIR_REL, n), 10_000]));

  it('copies all three worker dispatchers from occt-worker/ → public/occt-worker/', () => {
    const fs = makeFs(allWorkers());
    const out = copyWorkerScripts({ root: ROOT, fs });
    expect(out.copied).toEqual(WORKER_FILES);
    expect(out.skipped).toEqual([]);
    expect(out.warnings).toEqual([]);
    const dstDir = path.join(ROOT, DST_DIR_REL);
    for (const name of WORKER_FILES) {
      expect(fs.__copies).toContainEqual({
        src: path.join(ROOT, WORKER_SRC_DIR_REL, name),
        dst: path.join(dstDir, name),
      });
    }
  });

  it('serves the real dispatcher + launcher (not just the stub)', () => {
    expect(WORKER_FILES).toContain('occt-worker-real.js');
    expect(WORKER_FILES).toContain('occt-worker-launcher.js');
  });

  it('warns + skips a missing worker file but keeps copying the rest', () => {
    const initial = allWorkers();
    delete initial[path.join(WORKER_SRC_DIR_REL, 'occt-worker-real.js')];
    const fs = makeFs(initial);
    const out = copyWorkerScripts({ root: ROOT, fs });
    expect(out.copied).toContain('occt-worker.js');
    expect(out.copied).toContain('occt-worker-launcher.js');
    expect(out.skipped).toEqual(['occt-worker-real.js']);
    expect(out.warnings.some((w) => w.includes('occt-worker-real.js'))).toBe(true);
  });

  it('is non-fatal when mkdirSync throws', () => {
    const fs = makeFs(allWorkers(), { __throwOnMkdir: true });
    const out = copyWorkerScripts({ root: ROOT, fs });
    expect(out.copied).toEqual([]);
    expect(out.skipped).toEqual(WORKER_FILES);
    expect(out.warnings.some((w) => w.includes('failed to create destination dir'))).toBe(true);
  });

  it('warns per-file when copyFileSync throws but continues', () => {
    const fs = makeFs(allWorkers(), { __throwOnCopy: 'occt-worker-real.js' });
    const out = copyWorkerScripts({ root: ROOT, fs });
    expect(out.copied).toContain('occt-worker.js');
    expect(out.skipped).toContain('occt-worker-real.js');
    expect(out.warnings.some((w) => w.includes('copy failed for worker occt-worker-real.js'))).toBe(true);
  });
});
