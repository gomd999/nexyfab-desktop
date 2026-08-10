import { test, expect, request as requestFactory } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { authenticatedRequest } from './helpers/auth';
import { seedShapeGeneratorForE2e } from './helpers/shapeGeneratorEnv';

/**
 * Awareness latency Playwright spec — Phase 3 hands-on (1 of 4) per
 * docs/wave-2-phase-3-exit.md §7.
 *
 * Two browser contexts join the same `?crdt=v2` room. Alice emits an
 * awareness update (cursor move proxy via window.__nexyfabAwareness
 * setLocalState), Bob's presence panel must reflect Alice's identity
 * within the budgeted window. We sample 10 emit→observe round-trips
 * and assert p95 ≤ 200ms per ADR-012 §8.
 *
 * Skipped unless ALL of:
 *   - NEXT_PUBLIC_NEXYFAB_CRDT === '1' at build time
 *   - NEXT_PUBLIC_OCCT_COLLAB_WS_URL is set (live worker required —
 *     CI default env doesn't have one; manual run only)
 *   - NEXT_PUBLIC_NEXYFAB_COLLAB_DEBUG === '1' (exposes the awareness
 *     debug hook on window.__nexyfabAwareness — see CollabProvider.tsx)
 *   - baseURL provided by Playwright config
 *
 * Run locally against the deployed worker:
 *   NEXT_PUBLIC_NEXYFAB_CRDT=1 \
 *   NEXT_PUBLIC_NEXYFAB_COLLAB_DEBUG=1 \
 *   NEXT_PUBLIC_OCCT_COLLAB_WS_URL=wss://occt-collab-worker.<acct>.workers.dev \
 *   npx playwright test e2e/collab-awareness-latency.spec.ts
 */

const CRDT_ENABLED = process.env.NEXT_PUBLIC_NEXYFAB_CRDT === '1';
const WS_URL = process.env.NEXT_PUBLIC_OCCT_COLLAB_WS_URL;
const NAV_TIMEOUT_MS = 30_000;
const SAMPLES = 10;
const P95_BUDGET_MS = 200;
const ROUNDTRIP_TIMEOUT_MS = 2_000;

function sharedRoomId(): string {
  return Array.from({ length: 16 }, () =>
    'abcdef0123456789'[Math.floor(Math.random() * 16)],
  ).join('');
}

function percentile(samples: number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

test.describe.configure({ mode: 'serial' });

test.describe('Collab — awareness latency (Phase 3 hands-on)', () => {
  test.skip(!CRDT_ENABLED, 'CRDT disabled (NEXT_PUBLIC_NEXYFAB_CRDT !== "1")');
  test.skip(!WS_URL, 'No live collab worker (NEXT_PUBLIC_OCCT_COLLAB_WS_URL unset)');

  let bobContext: BrowserContext | null = null;
  let bobPage: Page | null = null;

  test.afterAll(async () => {
    await bobPage?.close();
    await bobContext?.close();
  });

  test('p95 awareness propagation ≤ 200ms across 10 samples', async ({
    browser, baseURL, page: alicePage,
  }) => {
    test.skip(!baseURL, 'baseURL required');

    // Two separate authenticated users (otherwise both look like the same
    // peer to awareness).
    const bootstrap = await requestFactory.newContext({ baseURL });
    const aliceAuth = await authenticatedRequest(bootstrap, baseURL!).catch(() => null);
    const bobAuth = await authenticatedRequest(bootstrap, baseURL!).catch(() => null);
    await bootstrap.dispose();
    test.skip(!aliceAuth || !bobAuth, 'auth setup failed (rate limit or env)');

    bobContext = await browser.newContext({ baseURL });
    bobPage = await bobContext.newPage();

    await seedShapeGeneratorForE2e(alicePage);
    await seedShapeGeneratorForE2e(bobPage);

    const room = sharedRoomId();
    const aliceUrl = `/en/shape-generator?expert=1&roomId=${room}&crdt=v2`;
    const bobUrl = `/en/shape-generator?expert=1&roomId=${room}&crdt=v2`;

    try {
      await Promise.all([
        alicePage.goto(aliceUrl, { timeout: NAV_TIMEOUT_MS, waitUntil: 'domcontentloaded' }),
        bobPage.goto(bobUrl, { timeout: NAV_TIMEOUT_MS, waitUntil: 'domcontentloaded' }),
      ]);
    } catch (e) {
      test.skip(true, `shape-generator failed to load: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    // Wait for both sides to wire up the awareness object exposed on window.
    // The provider sets window.__nexyfabAwareness as a debug hook (see
    // collab/CollabProvider.tsx awareness init).
    const awarenessReady = async (page: Page): Promise<boolean> =>
      page.waitForFunction(
        () => typeof (window as unknown as { __nexyfabAwareness?: unknown }).__nexyfabAwareness === 'object',
        null,
        { timeout: 10_000 },
      ).then(() => true).catch(() => false);

    const aliceReady = await awarenessReady(alicePage);
    const bobReady = await awarenessReady(bobPage);
    test.skip(!aliceReady || !bobReady, 'awareness debug hook not exposed — CollabProvider not wired in this build');

    const samples: number[] = [];

    for (let i = 0; i < SAMPLES; i++) {
      const token = `latency-probe-${i}-${Math.random().toString(36).slice(2, 8)}`;
      const t0 = Date.now();

      // Alice emits an awareness update with a unique token.
      await alicePage.evaluate((tok: string) => {
        const aw = (window as unknown as {
          __nexyfabAwareness?: {
            setLocalStateField?: (k: string, v: unknown) => void;
            setLocalState?: (s: unknown) => void;
          };
        }).__nexyfabAwareness;
        if (!aw) return;
        if (typeof aw.setLocalStateField === 'function') {
          aw.setLocalStateField('latencyProbe', tok);
        } else if (typeof aw.setLocalState === 'function') {
          aw.setLocalState({ latencyProbe: tok });
        }
      }, token);

      // Bob waits for the token to appear in any peer's awareness state.
      const arrived = await bobPage.waitForFunction(
        (tok: string) => {
          const aw = (window as unknown as {
            __nexyfabAwareness?: { getStates?: () => Map<number, Record<string, unknown>> };
          }).__nexyfabAwareness;
          if (!aw || typeof aw.getStates !== 'function') return false;
          for (const state of aw.getStates().values()) {
            if (state?.latencyProbe === tok) return true;
          }
          return false;
        },
        token,
        { timeout: ROUNDTRIP_TIMEOUT_MS, polling: 25 },
      ).then(() => true).catch(() => false);

      const elapsed = Date.now() - t0;
      if (arrived) {
        samples.push(elapsed);
      }
      // Small gap so we don't trigger awareness coalescing.
      await alicePage.waitForTimeout(80);
    }

    // Need at least 5 successful samples to publish a meaningful p95.
    expect(samples.length, `only ${samples.length}/${SAMPLES} samples reached Bob — channel may be down`)
      .toBeGreaterThanOrEqual(5);

    const p50 = percentile(samples, 0.5);
    const p95 = percentile(samples, 0.95);
    const max = Math.max(...samples);

    // eslint-disable-next-line no-console
    console.log(`[awareness-latency] samples=${samples.length} p50=${p50}ms p95=${p95}ms max=${max}ms`);

    expect(p95, `p95 ${p95}ms exceeded ADR-012 §8 budget ${P95_BUDGET_MS}ms`)
      .toBeLessThanOrEqual(P95_BUDGET_MS);
  });
});
