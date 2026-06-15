/**
 * occt-worker-launcher — unit tests for the Phase 5 feature-detection wrapper.
 *
 * Strategy: the launcher is a classic-worker IIFE that uses `self`,
 * `self.postMessage`, and `importScripts` — none of which exist in vitest's
 * `node` environment. We synthesise minimal globals, then `vm.runInNewContext`
 * the launcher source so each test gets a fresh execution. This is the same
 * pattern used by the chrome / firefox dev tools to harness worker scripts.
 *
 * The launcher reads `self` and `importScripts` from the context's global
 * object, so we can drive every branch by swapping the importScripts impl.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';

// The launcher source lives in occt-worker/ at the repo root. Resolve
// relative to this test file: src/lib/occt/ → up three levels → repo root,
// then into occt-worker/.
const LAUNCHER_PATH = path.resolve(__dirname, '../../../occt-worker/occt-worker-launcher.js');
const LAUNCHER_SRC = fs.readFileSync(LAUNCHER_PATH, 'utf8');

interface PostedMessage {
  event?: string;
  mode?: string;
  reason?: string;
}

/**
 * Build a fake worker global. The launcher reads `self.postMessage` and
 * `importScripts`. We record posted messages and the order of importScripts
 * calls so tests can assert both load order and mode event payload.
 */
function makeWorkerContext(
  importHandler: (url: string) => void,
): { ctx: vm.Context; posted: PostedMessage[]; imported: string[] } {
  const posted: PostedMessage[] = [];
  const imported: string[] = [];

  const self = {
    postMessage(msg: PostedMessage): void {
      posted.push(msg);
    },
    onmessage: null as ((e: { data: unknown }) => void) | null,
  };

  const importScripts = (url: string): void => {
    imported.push(url);
    importHandler(url);
  };

  const sandbox: Record<string, unknown> = {
    self,
    importScripts,
    console,
    setTimeout,
    clearTimeout,
  };
  // The launcher uses `self.postMessage` directly. Also expose `globalThis`
  // properties Emscripten loaders typically poke (no-op for these tests).
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  return { ctx, posted, imported };
}

/** Run the launcher source in the prepared context. */
function runLauncher(ctx: vm.Context): void {
  vm.runInContext(LAUNCHER_SRC, ctx, { filename: LAUNCHER_PATH });
}

describe('occt-worker-launcher', () => {
  describe('happy path — real OCCT loads', () => {
    let posted: PostedMessage[];
    let imported: string[];

    beforeEach(() => {
      const env = makeWorkerContext(() => {
        // Both importScripts calls succeed silently.
      });
      posted = env.posted;
      imported = env.imported;
      runLauncher(env.ctx);
    });

    it('imports opencascade.js BEFORE occt-worker-real.js', () => {
      expect(imported[0]).toBe('./opencascade.js');
      expect(imported[1]).toBe('./occt-worker-real.js');
    });

    it('posts a single mode=wasm event', () => {
      const modeEvents = posted.filter((m) => m.event === 'mode');
      expect(modeEvents).toHaveLength(1);
      expect(modeEvents[0].mode).toBe('wasm');
    });

    it('does NOT load the stub when real path succeeds', () => {
      expect(imported).not.toContain('./occt-worker.js');
    });

    it('mode=wasm event carries no `reason` (only stub fallback explains why)', () => {
      const modeEvent = posted.find((m) => m.event === 'mode');
      expect(modeEvent?.reason).toBeUndefined();
    });
  });

  describe('fallback — opencascade.js fails to load', () => {
    let posted: PostedMessage[];
    let imported: string[];

    beforeEach(() => {
      const env = makeWorkerContext((url) => {
        if (url === './opencascade.js') {
          throw new Error('404 Not Found');
        }
        // ./occt-worker.js (the stub) loads fine
      });
      posted = env.posted;
      imported = env.imported;
      runLauncher(env.ctx);
    });

    it('does NOT attempt to load occt-worker-real.js when loader fails', () => {
      expect(imported).not.toContain('./occt-worker-real.js');
    });

    it('falls back to importing the stub at occt-worker.js', () => {
      expect(imported).toContain('./occt-worker.js');
    });

    it('posts mode=stub with a reason mentioning opencascade.js', () => {
      const modeEvent = posted.find((m) => m.event === 'mode');
      expect(modeEvent?.mode).toBe('stub');
      expect(modeEvent?.reason).toContain('opencascade.js');
      expect(modeEvent?.reason).toContain('404');
    });
  });

  describe('fallback — opencascade.js OK but real dispatcher fails', () => {
    let posted: PostedMessage[];

    beforeEach(() => {
      const env = makeWorkerContext((url) => {
        if (url === './occt-worker-real.js') {
          throw new Error('SyntaxError: Unexpected token');
        }
      });
      posted = env.posted;
      runLauncher(env.ctx);
    });

    it('posts mode=stub with a reason mentioning occt-worker-real.js', () => {
      const modeEvent = posted.find((m) => m.event === 'mode');
      expect(modeEvent?.mode).toBe('stub');
      expect(modeEvent?.reason).toContain('occt-worker-real.js');
    });
  });

  describe('both paths fail — kernel unavailable', () => {
    let posted: PostedMessage[];

    beforeEach(() => {
      const env = makeWorkerContext(() => {
        throw new Error('every importScripts call rejects');
      });
      posted = env.posted;
      runLauncher(env.ctx);
    });

    it('still posts a mode event so the bridge can show "unavailable"', () => {
      const modeEvent = posted.find((m) => m.event === 'mode');
      expect(modeEvent).toBeDefined();
      expect(modeEvent?.mode).toBe('stub');
    });

    it('reason mentions BOTH failing paths so debugging is possible', () => {
      const modeEvent = posted.find((m) => m.event === 'mode');
      expect(modeEvent?.reason).toContain('launcher: both real and stub paths failed');
    });
  });

  describe('defensive — non-function postMessage does not crash launcher', () => {
    it('still attempts to import the stub even if postMessage is broken', () => {
      const imported: string[] = [];
      const self = {
        postMessage: null, // intentionally not a function
        onmessage: null,
      };
      const importScripts = (url: string): void => {
        imported.push(url);
        if (url === './opencascade.js') throw new Error('boom');
      };
      const ctx = vm.createContext({
        self,
        importScripts,
        console,
        setTimeout,
        clearTimeout,
      });
      // Must NOT throw — the launcher silently swallows the postMessage failure.
      expect(() => runLauncher(ctx)).not.toThrow();
      // Stub fallback still attempted.
      expect(imported).toContain('./occt-worker.js');
    });
  });
});
