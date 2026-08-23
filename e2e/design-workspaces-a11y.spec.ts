import { expect, test, type Page } from '@playwright/test';
import axe from 'axe-core';

interface AxeViolation {
  id: string;
  impact?: 'minor' | 'moderate' | 'serious' | 'critical';
  description: string;
  nodes: Array<{ target: string[]; html: string }>;
}

async function seriousViolations(page: Page, include: string): Promise<AxeViolation[]> {
  await page.addScriptTag({ content: axe.source });
  return page.evaluate(async (selector) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const axeApi = (window as any).axe as {
      run: (
        context: string,
        options: { runOnly: { type: 'tag'; values: string[] } },
      ) => Promise<{ violations: AxeViolation[] }>;
    };
    const result = await axeApi.run(selector, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    });
    return result.violations.filter(item => item.impact === 'critical' || item.impact === 'serious');
  }, include);
}

function summary(violations: AxeViolation[]): string {
  return violations.map(item =>
    `[${item.impact}] ${item.id}: ${item.description}\n${item.nodes.map(node =>
      `  ${node.target.join(' ')}: ${node.html}`).join('\n')}`,
  ).join('\n');
}

const cases = [
  { name: 'guided design desktop', path: '/kr/nexyfab/design/', width: 1440, height: 900, scope: '[class*="DesignInner_root__"]' },
  { name: 'guided design mobile', path: '/kr/nexyfab/design/', width: 393, height: 852, scope: '[class*="DesignInner_root__"]' },
  { name: 'precision CAD desktop', path: '/kr/shape-generator/?expert=1', width: 1440, height: 900, scope: '.nx-app' },
  { name: 'precision CAD mobile', path: '/kr/shape-generator/?expert=1', width: 393, height: 852, scope: '.nx-app[data-viewport-only="true"]' },
] as const;

test.describe('a11y · core design workspaces', () => {
  test.setTimeout(120_000);

  for (const item of cases) {
    test(`${item.name} has no critical or serious flow blockers`, async ({ page }) => {
      await page.setViewportSize({ width: item.width, height: item.height });
      await page.goto(item.path, { waitUntil: 'domcontentloaded' });
      await page.locator(item.scope).waitFor({ state: 'visible', timeout: 90_000 });
      await page.waitForTimeout(1_000);
      const violations = await seriousViolations(page, item.scope);
      expect(violations, summary(violations)).toEqual([]);
    });
  }
});
