import { expect, test, type Page } from '@playwright/test';
import axe from 'axe-core';

const GUIDED_CAD_URL = '/en/shape-generator/?expert=1&domain=mechanical&experience=guided&workMode=ai_assisted';
const BRACKET_PROMPT = 'Design an exact L-bracket with 100 mm × 50 mm legs, length 40 mm, thickness 5 mm, ±0.1 mm tolerance, 6061-T6 aluminum, CNC milling';

interface AxeViolation {
  id: string;
  impact?: 'minor' | 'moderate' | 'serious' | 'critical';
  nodes: Array<{ target: string[]; html: string }>;
}

async function seriousAccessibilityViolations(page: Page): Promise<AxeViolation[]> {
  await page.addScriptTag({ content: axe.source });
  return page.evaluate(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const axeApi = (window as any).axe as {
      run: (context: string, options: { runOnly: { type: 'tag'; values: string[] } }) => Promise<{ violations: AxeViolation[] }>;
    };
    const result = await axeApi.run('[role="region"][aria-label="Local deterministic CAD candidate"]', {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    });
    return result.violations.filter(item => item.impact === 'serious' || item.impact === 'critical');
  });
}

test('guided local mechanical design closes Preview → Apply → FeatureTree revision → Undo without an AI model call', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'desktop guided CAD path');
  test.setTimeout(180_000);
  const modelRequests: string[] = [];
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('request', request => {
    if (/scad-agent|featureTree-intent/.test(request.url())) modelRequests.push(request.url());
  });
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', error => pageErrors.push(error.message));

  const response = await page.goto(GUIDED_CAD_URL, { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBeLessThan(400);
  await expect(page.getByTestId('shape-generator-workspace')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole('button', { name: 'Guided', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('textbox', { name: 'AI message input' })).toBeVisible({ timeout: 90_000 });

  const input = page.getByRole('textbox', { name: 'AI message input' });
  await input.fill(BRACKET_PROMPT);
  await input.press('Enter');
  const truth = page.getByTestId('guided-local-execution-truth');
  await expect(truth).toContainText('PLAN · LOCAL DETERMINISTIC');
  await expect(truth).toContainText('AI MODEL · NOT_RUN');
  await expect(page.getByTestId('requirement-gate-state').last()).toHaveText('AUTHORITATIVE');
  await expect(page.getByTestId('ai-candidate-state')).toHaveText('PREVIEW');
  expect(await seriousAccessibilityViolations(page)).toEqual([]);
  expect(modelRequests).toEqual([]);

  const apply = page.getByRole('button', { name: 'Explicit Apply' });
  await apply.focus();
  await expect(apply).toBeFocused();
  await apply.press('Enter');
  await expect(page.getByTestId('ai-candidate-state')).toHaveText('APPLIED', { timeout: 90_000 });
  await expect(page.getByTestId('ai-candidate-featuretree-revision')).toContainText('CREATED', { timeout: 90_000 });
  await expect(page.getByText('Geometry reverification').locator('..')).toContainText('NOT_RUN');
  await expect(page.getByText('DFM reverification').locator('..')).toContainText('NOT_RUN');
  expect(modelRequests).toEqual([]);

  const undo = page.getByRole('button', { name: /Undo this Apply/ });
  await undo.focus();
  await expect(undo).toBeFocused();
  await undo.press('Enter');
  await expect(page.getByTestId('ai-candidate-featuretree-revision')).toContainText('RESTORED', { timeout: 90_000 });
  expect(modelRequests).toEqual([]);

  const expert = page.getByRole('button', { name: 'Expert', exact: true });
  await expert.focus();
  await expect(expert).toBeFocused();
  await expert.press('Enter');
  await expect(expert).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('tab', { name: 'Inspector' })).toHaveAttribute('aria-selected', 'true');

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
