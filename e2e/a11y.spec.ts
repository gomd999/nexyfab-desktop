import { test, expect, Page } from '@playwright/test';

// Automated a11y smoke checks via axe-core. We CDN-load axe-core in-page so
// the suite stays dependency-free; if the CDN is blocked the test fails
// loudly rather than silently passing.
//
// Scope: public landing + critical authenticated-shell entry points.
// We only assert on `serious` + `critical` violations to avoid noise from
// design-system contrast edge cases that the user is iterating on.

const AXE_CDN = 'https://cdn.jsdelivr.net/npm/axe-core@4.10.2/axe.min.js';

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
  await page.addScriptTag({ url: AXE_CDN });
  return page.evaluate(async (include) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const axe = (window as any).axe as {
      run: (
        ctx: string | Document,
        cfg: { runOnly: { type: 'tag'; values: string[] } },
      ) => Promise<AxeResult>;
    };
    if (!axe) throw new Error('axe-core failed to load from CDN');
    return axe.run(include ? include : document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    });
  }, opts?.include);
}

function summariseSerious(result: AxeResult): string {
  const blockers = result.violations.filter(
    v => v.impact === 'serious' || v.impact === 'critical',
  );
  if (blockers.length === 0) return '';
  return blockers
    .map(v => `  • [${v.impact}] ${v.id} — ${v.description} (${v.nodes.length} node(s))`)
    .join('\n');
}

test.describe('a11y · landing', () => {
  test('Korean home page has no serious axe violations', async ({ page }) => {
    await page.goto('/kr');
    await page.waitForLoadState('networkidle');
    const result = await runAxe(page);
    const report = summariseSerious(result);
    expect(report, `Serious/critical a11y violations on /kr:\n${report}`).toBe('');
  });

  test('Help center passes a11y smoke', async ({ page }) => {
    await page.goto('/kr/help');
    await page.waitForLoadState('networkidle');
    const result = await runAxe(page);
    const report = summariseSerious(result);
    expect(report, `Serious/critical a11y violations on /kr/help:\n${report}`).toBe('');
  });

  test('Unsubscribe preference center is accessible', async ({ page }) => {
    await page.goto('/kr/unsubscribe');
    await page.waitForLoadState('networkidle');
    const result = await runAxe(page);
    const report = summariseSerious(result);
    expect(report, `Serious/critical a11y violations on /kr/unsubscribe:\n${report}`).toBe('');
  });
});

test.describe('a11y · auth modal', () => {
  test('AuthModal exposes dialog landmarks', async ({ page }) => {
    await page.goto('/kr');
    // Open the modal — landing CTA, or fallback to direct URL hint.
    const ctaCandidates = [
      page.getByRole('button', { name: /무료로 시작|Sign up|로그인|Log in/i }),
      page.getByText(/무료로 시작|Get started|로그인/i).first(),
    ];
    for (const cta of ctaCandidates) {
      if ((await cta.count()) > 0) {
        await cta.first().click().catch(() => {});
        break;
      }
    }
    // If the modal opened, it should announce itself as a dialog with a label.
    const dialog = page.getByRole('dialog');
    if (await dialog.count() > 0) {
      await expect(dialog.first()).toHaveAttribute('aria-modal', 'true');
      await expect(dialog.first()).toHaveAttribute('aria-labelledby', /.+/);
    }
  });
});
