import { expect, test, type Page } from '@playwright/test';
import axe from 'axe-core';

// Inject the pinned local axe-core dependency. This keeps production CSP
// strict and makes the release gate independent of an external CDN.
interface AxeViolation {
  id: string;
  impact?: 'minor' | 'moderate' | 'serious' | 'critical';
  description: string;
  helpUrl: string;
  nodes: Array<{ target: string[]; html: string }>;
}

interface AxeResult {
  violations: AxeViolation[];
}

async function runAxe(page: Page, opts?: { include?: string }): Promise<AxeResult> {
  await page.addScriptTag({ content: axe.source });
  return page.evaluate(async (include) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const axeApi = (window as any).axe as {
      run: (
        ctx: string | Document,
        cfg: { runOnly: { type: 'tag'; values: string[] } },
      ) => Promise<AxeResult>;
    };
    if (!axeApi) throw new Error('axe-core failed to load from the local dependency');
    return axeApi.run(include || document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    });
  }, opts?.include);
}

function summariseSerious(result: AxeResult): string {
  const blockers = result.violations.filter(
    violation => violation.impact === 'serious' || violation.impact === 'critical',
  );
  if (blockers.length === 0) return '';
  return blockers
    .map((violation) => {
      const nodeDetails = violation.nodes
        .map(node => `\n      target: ${node.target.join(' ')}\n      html: ${node.html}`)
        .join('');
      return `  • [${violation.impact}] ${violation.id} — ${violation.description}${nodeDetails} (${violation.nodes.length} node(s))`;
    })
    .join('\n');
}

test.describe('a11y · landing', () => {
  test('Korean home page has no serious axe violations', async ({ page }) => {
    await page.goto('/kr');
    await page.waitForLoadState('networkidle');
    const report = summariseSerious(await runAxe(page));
    expect(report, `Serious/critical a11y violations on /kr:\n${report}`).toBe('');
  });

  test('Help center passes a11y smoke', async ({ page }) => {
    await page.goto('/kr/help');
    await page.waitForLoadState('networkidle');
    const report = summariseSerious(await runAxe(page));
    expect(report, `Serious/critical a11y violations on /kr/help:\n${report}`).toBe('');
  });

  test('Unsubscribe preference center is accessible', async ({ page }) => {
    await page.goto('/kr/unsubscribe');
    await page.waitForLoadState('networkidle');
    const report = summariseSerious(await runAxe(page));
    expect(report, `Serious/critical a11y violations on /kr/unsubscribe:\n${report}`).toBe('');
  });
});

test.describe('a11y · auth modal', () => {
  test('AuthModal exposes dialog landmarks', async ({ page }) => {
    await page.goto('/kr/nexyfab/hub');
    await page.getByRole('button', { name: '로그인', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: /로그인하여 계속하기|Sign in to continue/ });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog).toHaveAttribute('aria-labelledby', /.+/);
  });
});
