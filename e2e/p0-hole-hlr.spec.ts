import { expect, test } from '@playwright/test';
import {
  dismissShapeGeneratorOverlays,
  seedShapeGeneratorForE2e,
} from './helpers/shapeGeneratorEnv';

const TWO_HOLE_PROGRAM = {
  part: 'P0 two-hole plate',
  features: [
    { id: 'base', type: 'sketchExtrude', shape: 'rect', width: 100, depth: 60, height: 8 },
    { id: 'hole-left', type: 'hole', diameter: 10, posX: -20, posY: 0, holeType: 0 },
    { id: 'hole-right', type: 'hole', diameter: 10, posX: 20, posY: 0, holeType: 0 },
  ],
};

type Probe = {
  ok: boolean;
  resultNull: boolean;
  resultOcctHandle: string | null;
  resultHandleInWorker: boolean;
  occtMode: boolean;
  occtInitPending: boolean;
  occtInitError: string | null;
  pipelineWorkerLoading: boolean;
  isMobile: boolean;
  pipelineErrors: Record<string, string>;
  bbox: { min: number[]; max: number[] } | null;
  nodes: Array<{ featureType: string | null; params: Record<string, number> }>;
};

test.describe('P0 two-hole worker HLR', () => {
  test('AI handoff program keeps Ø10×2 in the browser worker B-rep and drawing DOM', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile-chrome', 'desktop drawing entry point');
    test.setTimeout(360_000);
    await seedShapeGeneratorForE2e(page);
    await page.addInitScript(() => {
      type Summary = {
        type: string;
        occtHandle?: string | null;
        errors?: Record<string, string>;
        meshDowngrades?: unknown[];
        positionCount?: number;
      };
      const target = window as unknown as { __nfabPipelineMessages: Summary[]; Worker: typeof Worker };
      target.__nfabPipelineMessages = [];
      const NativeWorker = window.Worker;
      class DiagnosticWorker extends NativeWorker {
        constructor(scriptURL: string | URL, options?: WorkerOptions) {
          super(scriptURL, options);
          this.addEventListener('message', event => {
            const data = event.data as {
              type?: string;
              occtHandle?: string | null;
              errors?: Record<string, string>;
              meshDowngrades?: unknown[];
              positions?: Float32Array;
            };
            if (data?.type === 'PIPELINE_RESULT' || data?.type === 'PIPELINE_ERROR') {
              target.__nfabPipelineMessages.push({
                type: data.type,
                occtHandle: data.occtHandle,
                errors: data.errors,
                meshDowngrades: data.meshDowngrades,
                positionCount: data.positions?.length,
              });
            }
          });
        }
      }
      target.Worker = DiagnosticWorker;
    });
    // sessionStorage is origin-scoped. Establish the E2E origin first; writing
    // from the initial about:blank document is not reliable across browsers.
    const bootstrap = await page.goto('/api/health/live', { waitUntil: 'domcontentloaded' });
    expect(bootstrap?.status()).toBeLessThan(400);
    await page.evaluate(program => {
      sessionStorage.setItem('nexyfab:studio-handoff-program', JSON.stringify(program));
    }, TWO_HOLE_PROGRAM);

    const consoleErrors: string[] = [];
    const kernelDiagnostics: string[] = [];
    let pipelineWorkerCsp: string | null = null;
    page.on('console', message => {
      if (message.type() === 'error') consoleErrors.push(message.text());
      if ((message.type() === 'error' || message.type() === 'warning')
        && /occt|wasm|worker|hole|pipeline/i.test(message.text())) {
        kernelDiagnostics.push(`console:${message.type()}:${message.text()}`);
      }
    });
    page.on('requestfailed', request => {
      if (/occt|wasm|worker/i.test(request.url())) {
        kernelDiagnostics.push(`requestfailed:${request.url()}:${request.failure()?.errorText ?? 'unknown'}`);
      }
    });
    page.on('response', response => {
      if (/occt|wasm|worker/i.test(response.url())) {
        kernelDiagnostics.push(`response:${response.status()}:${response.url()}`);
      }
      if (/\/pipeline-worker\.[^/]+\.js(?:\?|$)/i.test(response.url())) {
        void response.headerValue('content-security-policy').then(value => {
          pipelineWorkerCsp = value;
        });
      }
    });

    const response = await page.goto('/kr/shape-generator?expert=1&mode=expert', { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBeLessThan(400);
    await dismissShapeGeneratorOverlays(page);
    await expect(page.getByTestId('shape-generator-workspace')).toBeVisible({ timeout: 60_000 });
    const handoffBanner = page.getByTestId('ai-cad-handoff-banner');
    // A cold browser must initialize the main-thread OCCT kernel before the
    // precise handoff is replayed. The 10 MB WASM compile can exceed the
    // default 5 s locator timeout on CI even though the workspace is visible.
    await expect(handoffBanner).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId('ai-cad-handoff-title')).toContainText(/P0 two-hole plate.*3/);
    await expect(handoffBanner).toContainText(/편집 가능한 B-rep|Editable B-rep/);
    await page.getByTestId('dismiss-ai-cad-handoff').click();
    await expect(handoffBanner).toBeHidden();

    try {
      await page.waitForFunction(() => {
        const fn = (window as unknown as { __nfabProbe?: () => Probe }).__nfabProbe;
        if (!fn) return false;
        const probe = fn();
        return probe.ok && !probe.resultNull && probe.resultHandleInWorker && !!probe.resultOcctHandle;
      }, undefined, { timeout: 90_000 });
    } catch (error) {
      const lastProbe = await page.evaluate(() =>
        (window as unknown as { __nfabProbe?: () => unknown }).__nfabProbe?.() ?? null);
      const pipelineMessages = await page.evaluate(() =>
        (window as unknown as { __nfabPipelineMessages?: unknown[] }).__nfabPipelineMessages ?? []);
      throw new Error(
        `worker B-rep did not become ready: probe=${JSON.stringify(lastProbe)} pipelineMessages=${JSON.stringify(pipelineMessages)} kernelDiagnostics=${JSON.stringify(kernelDiagnostics)} consoleErrors=${JSON.stringify(consoleErrors)}`,
        { cause: error },
      );
    }

    const probe = await page.evaluate(() =>
      (window as unknown as { __nfabProbe: () => Probe }).__nfabProbe());
    expect(probe.pipelineErrors).toEqual({});
    expect(probe.resultOcctHandle).toMatch(/^occt:\d+$/);
    expect(probe.resultHandleInWorker).toBe(true);
    expect(pipelineWorkerCsp).toContain("'unsafe-eval'");
    expect(probe.nodes.filter(node => node.featureType === 'hole')).toHaveLength(2);
    expect(probe.bbox?.min).toEqual(expect.arrayContaining([-50, -4, -30]));
    expect(probe.bbox?.max).toEqual(expect.arrayContaining([50, 4, 30]));

    // Export while the command toolbar is visible. It must use the exact
    // worker-owned B-rep, not the display mesh.
    await page.getByTitle('New').click();
    const exportStep = page.locator('button:visible').filter({ hasText: /Export STEP|STEP.*내보내기/i }).first();
    await expect(exportStep).toBeEnabled();
    await exportStep.click();
    await expect(page.getByText(/STEP.*Pro.*기능|STEP.*Pro.*feature/i)).toBeVisible();
    const upgradeDialog = page.getByRole('dialog', { name: /업그레이드 플랜 선택|Upgrade plan/i });
    await upgradeDialog.getByRole('button', { name: /닫기|Close dialog/i }).click();
    await page.getByTestId('drawing-view-toggle').click();
    const hlrToggle = page.getByTestId('drawing-hlr-toggle');
    await expect(hlrToggle).toBeVisible({ timeout: 30_000 });
    await hlrToggle.click();

    const front = page.getByTestId('hlr-view-front');
    await expect(front).toBeVisible({ timeout: 30_000 });
    const diameter = front.getByTestId('hlr-diameter-front-0');
    await expect(diameter).toHaveAttribute('data-diameter-mm', '10');
    await expect(diameter).toHaveAttribute('data-count', '2');
    await expect(diameter).toContainText(/⌀10(?:\.0)?\s*mm\s*×2/);

    const frontText = await front.locator('text').allTextContents();
    expect(frontText).toContain('30.0 mm');
    expect(frontText).toContain('70.0 mm');
    const arcPaths = await front.locator('path').evaluateAll(paths =>
      paths.filter(path => /A/i.test(path.getAttribute('d') ?? '')).length);
    expect(arcPaths).toBeGreaterThanOrEqual(2);

    // Expert CAD continuation: edit both AI-created feature parameters through
    // the actual feature tree + Inspector, then require a fresh worker B-rep
    // and updated HLR callout. This proves the handoff is editable, not a mesh.
    await page.getByTestId('drawing-view-toggle').click();
    const holeTreeRows = page.getByRole('treeitem', { name: 'hole', exact: true });
    await expect(holeTreeRows).toHaveCount(2);
    for (let index = 0; index < 2; index++) {
      await holeTreeRows.nth(index).click();
      const diameterInput = page.getByTestId('inspector-param-diameter');
      await expect(diameterInput).toHaveValue('10');
      await diameterInput.fill('12');
      await diameterInput.press('Enter');
      await expect(diameterInput).toHaveValue('12');
    }
    await page.waitForFunction(() => {
      const fn = (window as unknown as { __nfabProbe?: () => Probe }).__nfabProbe;
      if (!fn) return false;
      const next = fn();
      const holes = next.nodes.filter(node => node.featureType === 'hole');
      return next.resultHandleInWorker && Object.keys(next.pipelineErrors).length === 0
        && holes.length === 2 && holes.every(node => node.params.diameter === 12);
    }, undefined, { timeout: 90_000 });

    const propertyManager = page.getByRole('region', { name: /hole (?:매개변수|parameters)/i });
    await propertyManager.getByRole('button', { name: /닫기|close/i }).click();
    await expect(propertyManager).toBeHidden();
    await page.getByTestId('drawing-view-toggle').click();
    const updatedHlrToggle = page.getByTestId('drawing-hlr-toggle');
    await expect(updatedHlrToggle).toBeVisible({ timeout: 30_000 });
    await updatedHlrToggle.click();
    const updatedFront = page.getByTestId('hlr-view-front');
    await expect(updatedFront).toBeVisible({ timeout: 30_000 });
    const updatedDiameter = updatedFront.locator('[data-diameter-mm="12"]').first();
    await expect(updatedDiameter).toHaveAttribute('data-count', '2');
    await expect(updatedDiameter).toContainText(/⌀12(?:\.0)?\s*mm\s*×2/);

    expect(consoleErrors.filter(text => /OCCT path failed|HLR projection failed|worker projection unavailable/i.test(text))).toEqual([]);
  });
});
