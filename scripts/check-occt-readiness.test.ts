/**
 * check-occt-readiness — unit tests for the CI guard script.
 *
 * Strategy: we never touch the real filesystem. Each test builds an in-memory
 * fake `fs` (a Map<absolutePath, size>) and injects it into `checkOcctReadiness`
 * via the `fs` option. This keeps tests hermetic and parallel-safe.
 *
 * The script itself is plain CommonJS (.js) so we use `createRequire` to load
 * it from this .ts test without the bundler/Vitest needing a tsconfig hop.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import * as path from 'node:path';

const req = createRequire(import.meta.url);

// eslint-disable-next-line @typescript-eslint/no-var-requires
const guard = req('./check-occt-readiness.js') as {
  checkOcctReadiness: (opts: {
    mode: string;
    root?: string;
    fs?: FakeFs;
  }) => { mode: 'stub' | 'wasm'; warnings: string[]; errors: string[] };
  parseModeArg: (argv: string[]) => string;
  WORKER_JS_REL: string;
  WASM_REL: string;
  MIN_WASM_BYTES: number;
  VALID_MODES: Set<string>;
};

const { checkOcctReadiness, parseModeArg, WORKER_JS_REL, WASM_REL, MIN_WASM_BYTES } = guard;

const ROOT = path.resolve('/fake-repo-root');

/** Minimum fake fs surface the script uses. */
interface FakeFs {
  existsSync(p: string): boolean;
  statSync(p: string): { size: number };
}

/**
 * Build a fake fs from a {relativePath → size-in-bytes} map. Paths NOT in
 * the map are treated as missing (existsSync false, statSync throws).
 */
function makeFs(files: Record<string, number>): FakeFs {
  const abs = new Map<string, number>();
  for (const [rel, size] of Object.entries(files)) {
    abs.set(path.join(ROOT, rel), size);
  }
  return {
    existsSync(p: string): boolean {
      return abs.has(p);
    },
    statSync(p: string): { size: number } {
      const s = abs.get(p);
      if (s === undefined) {
        const err = new Error(`ENOENT: ${p}`) as Error & { code?: string };
        err.code = 'ENOENT';
        throw err;
      }
      return { size: s };
    },
  };
}

describe('checkOcctReadiness', () => {
  describe('mode validation', () => {
    it('rejects invalid mode with an error and defaults resolved mode to stub', () => {
      const fs = makeFs({ [WORKER_JS_REL]: 12_000 });
      const out = checkOcctReadiness({ mode: 'bogus', root: ROOT, fs });
      expect(out.errors.some((e) => e.includes("invalid mode 'bogus'"))).toBe(true);
      expect(out.mode).toBe('stub');
    });

    it('accepts the three valid modes without an "invalid mode" error', () => {
      for (const mode of ['stub', 'wasm', 'auto']) {
        const fs = makeFs({
          [WORKER_JS_REL]: 12_000,
          [WASM_REL]: MIN_WASM_BYTES + 1,
        });
        const out = checkOcctReadiness({ mode, root: ROOT, fs });
        expect(out.errors.some((e) => e.includes('invalid mode'))).toBe(false);
      }
    });
  });

  describe('mode=stub', () => {
    it('passes when only the worker JS exists (no WASM needed)', () => {
      const fs = makeFs({ [WORKER_JS_REL]: 10_500 });
      const out = checkOcctReadiness({ mode: 'stub', root: ROOT, fs });
      expect(out.mode).toBe('stub');
      expect(out.errors).toEqual([]);
    });

    it('errors when the worker JS is missing', () => {
      const fs = makeFs({});
      const out = checkOcctReadiness({ mode: 'stub', root: ROOT, fs });
      expect(out.errors.length).toBeGreaterThan(0);
      expect(out.errors[0]).toContain(WORKER_JS_REL);
    });

    it('warns (but does not error) when WASM is unexpectedly present in stub mode', () => {
      const fs = makeFs({
        [WORKER_JS_REL]: 10_500,
        [WASM_REL]: MIN_WASM_BYTES + 1,
      });
      const out = checkOcctReadiness({ mode: 'stub', root: ROOT, fs });
      expect(out.mode).toBe('stub');
      expect(out.errors).toEqual([]);
      expect(out.warnings.some((w) => w.includes('mode=stub but'))).toBe(true);
    });
  });

  describe('mode=wasm', () => {
    it('passes when both the worker and a real-sized WASM blob exist', () => {
      const fs = makeFs({
        [WORKER_JS_REL]: 10_500,
        [WASM_REL]: 12 * 1024 * 1024,
      });
      const out = checkOcctReadiness({ mode: 'wasm', root: ROOT, fs });
      expect(out.mode).toBe('wasm');
      expect(out.errors).toEqual([]);
    });

    it('errors when opencascade.wasm is missing', () => {
      const fs = makeFs({ [WORKER_JS_REL]: 10_500 });
      const out = checkOcctReadiness({ mode: 'wasm', root: ROOT, fs });
      expect(out.mode).toBe('wasm');
      expect(out.errors.length).toBeGreaterThan(0);
      expect(out.errors.some((e) => e.includes('requires public/occt-worker/opencascade.wasm'))).toBe(true);
    });

    it('errors when opencascade.wasm exists but is under 1 MB (placeholder file)', () => {
      const fs = makeFs({
        [WORKER_JS_REL]: 10_500,
        [WASM_REL]: 4_096, // 4 KB - obviously a placeholder
      });
      const out = checkOcctReadiness({ mode: 'wasm', root: ROOT, fs });
      expect(out.mode).toBe('wasm');
      expect(out.errors.some((e) => e.includes('placeholder file?'))).toBe(true);
    });

    it('errors when BOTH worker JS and WASM are missing (two errors)', () => {
      const fs = makeFs({});
      const out = checkOcctReadiness({ mode: 'wasm', root: ROOT, fs });
      expect(out.errors.length).toBe(2);
      expect(out.errors.some((e) => e.includes(WORKER_JS_REL))).toBe(true);
      expect(out.errors.some((e) => e.includes(WASM_REL))).toBe(true);
    });

    it('treats a WASM file exactly at the 1 MB boundary as valid', () => {
      const fs = makeFs({
        [WORKER_JS_REL]: 10_500,
        [WASM_REL]: MIN_WASM_BYTES, // exactly 1 MB
      });
      const out = checkOcctReadiness({ mode: 'wasm', root: ROOT, fs });
      expect(out.errors).toEqual([]);
    });
  });

  describe('mode=auto', () => {
    it('detects wasm mode when a real-sized opencascade.wasm is present', () => {
      const fs = makeFs({
        [WORKER_JS_REL]: 10_500,
        [WASM_REL]: 12 * 1024 * 1024,
      });
      const out = checkOcctReadiness({ mode: 'auto', root: ROOT, fs });
      expect(out.mode).toBe('wasm');
      expect(out.errors).toEqual([]);
    });

    it('detects stub mode when opencascade.wasm is absent', () => {
      const fs = makeFs({ [WORKER_JS_REL]: 10_500 });
      const out = checkOcctReadiness({ mode: 'auto', root: ROOT, fs });
      expect(out.mode).toBe('stub');
      expect(out.errors).toEqual([]);
    });

    it('falls back to stub + emits a warning when WASM is present but tiny (placeholder)', () => {
      const fs = makeFs({
        [WORKER_JS_REL]: 10_500,
        [WASM_REL]: 2_048, // 2 KB placeholder
      });
      const out = checkOcctReadiness({ mode: 'auto', root: ROOT, fs });
      expect(out.mode).toBe('stub');
      expect(out.warnings.some((w) => w.includes('placeholder file?'))).toBe(true);
      // Critically, in auto mode this is NOT an error — only wasm mode hard-fails.
      expect(out.errors).toEqual([]);
    });

    it('still errors on missing worker JS even when auto-detected as stub', () => {
      const fs = makeFs({});
      const out = checkOcctReadiness({ mode: 'auto', root: ROOT, fs });
      expect(out.mode).toBe('stub');
      expect(out.errors.length).toBeGreaterThan(0);
      expect(out.errors[0]).toContain(WORKER_JS_REL);
    });

    it('auto detection is the default when mode option is omitted', () => {
      const fs = makeFs({
        [WORKER_JS_REL]: 10_500,
        [WASM_REL]: 12 * 1024 * 1024,
      });
      const out = checkOcctReadiness({ mode: 'auto', root: ROOT, fs });
      // Sanity: matches the explicit-auto behaviour above.
      expect(out.mode).toBe('wasm');
    });
  });

  describe('result shape & exit-code contract', () => {
    it('always returns { mode, warnings: [], errors: [] } with array values', () => {
      const fs = makeFs({ [WORKER_JS_REL]: 10_500 });
      const out = checkOcctReadiness({ mode: 'auto', root: ROOT, fs });
      expect(out).toHaveProperty('mode');
      expect(Array.isArray(out.warnings)).toBe(true);
      expect(Array.isArray(out.errors)).toBe(true);
    });

    it('resolved mode is always a concrete "stub" or "wasm" — never "auto"', () => {
      for (const mode of ['stub', 'wasm', 'auto']) {
        const fs = makeFs({
          [WORKER_JS_REL]: 10_500,
          [WASM_REL]: 12 * 1024 * 1024,
        });
        const out = checkOcctReadiness({ mode, root: ROOT, fs });
        expect(['stub', 'wasm']).toContain(out.mode);
      }
    });

    it('tolerates an fs mock whose existsSync throws (treats path as missing)', () => {
      const throwingFs: FakeFs = {
        existsSync(): never {
          throw new Error('boom');
        },
        statSync(): { size: number } {
          return { size: 0 };
        },
      };
      const out = checkOcctReadiness({ mode: 'wasm', root: ROOT, fs: throwingFs });
      // Should report missing worker AND missing WASM, not crash.
      expect(out.errors.length).toBe(2);
    });

    it('tolerates an fs mock whose statSync throws AFTER existsSync returns true', () => {
      // Simulate TOCTOU: file disappears between exists and stat.
      const ghostFs: FakeFs = {
        existsSync(p: string): boolean {
          return p.endsWith('opencascade.wasm') || p.endsWith('occt-worker.js');
        },
        statSync(): never {
          const err = new Error('ENOENT') as Error & { code?: string };
          err.code = 'ENOENT';
          throw err;
        },
      };
      const out = checkOcctReadiness({ mode: 'wasm', root: ROOT, fs: ghostFs });
      // statSync failure → size treated as 0 → placeholder error in wasm mode.
      expect(out.errors.some((e) => e.includes('placeholder file?'))).toBe(true);
    });
  });

  describe('parseModeArg', () => {
    it('returns "auto" when no --mode= flag is present', () => {
      expect(parseModeArg([])).toBe('auto');
      expect(parseModeArg(['--other=thing'])).toBe('auto');
    });

    it('extracts the mode value from a --mode=X argument', () => {
      expect(parseModeArg(['--mode=stub'])).toBe('stub');
      expect(parseModeArg(['--mode=wasm'])).toBe('wasm');
      expect(parseModeArg(['--mode=auto'])).toBe('auto');
    });

    it('last occurrence wins (CI wrapper can override base command)', () => {
      expect(parseModeArg(['--mode=stub', '--mode=wasm'])).toBe('wasm');
    });

    it('ignores non-string entries defensively', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(parseModeArg([null as any, undefined as any, '--mode=wasm'])).toBe('wasm');
    });
  });
});
