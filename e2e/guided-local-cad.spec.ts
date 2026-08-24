import { expect, test } from '@playwright/test';

const GUIDED_CAD_URL = '/en/shape-generator/?expert=1&domain=mechanical&experience=guided&workMode=ai_assisted';
const BRACKET_PROMPT = 'Design an exact L-bracket with 100 mm × 50 mm legs, length 40 mm, thickness 5 mm, ±0.1 mm tolerance, 6061-T6 aluminum, CNC milling';

test('guided mechanical design routes through the selected AI model without a local fallback', async ({ page }, testInfo) => {
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
  await expect(page.getByRole('button', { name: 'AI design', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('textbox', { name: 'AI message input' })).toBeVisible({ timeout: 90_000 });

  const input = page.getByRole('textbox', { name: 'AI message input' });
  await input.fill(BRACKET_PROMPT);
  const agentRequest = page.waitForRequest(request => /\/api\/nexyfab\/scad-agent(?:\?|$)/.test(request.url()));
  await input.press('Enter');
  const requestToAgent = await agentRequest;
  const requestBody = requestToAgent.postDataJSON() as Record<string, unknown>;
  expect(requestBody.executionMode).toBe('ai_design');
  expect(requestBody.designDomain).toBe('mechanical');
  expect(String(requestBody.userPrompt)).toContain('mechanical.critical_dimensions [user_confirmed]');
  await expect(page.getByTestId('requirement-gate-state').last()).toHaveText('AUTHORITATIVE');
  await expect(page.getByTestId('guided-local-execution-truth')).toHaveCount(0);
  expect(modelRequests).toHaveLength(1);
  await expect(page.getByTestId('ai-candidate-state')).toHaveCount(0);

  const precisionCad = page.getByRole('button', { name: 'Precision CAD', exact: true });
  await precisionCad.focus();
  await expect(precisionCad).toBeFocused();
  await precisionCad.press('Enter');
  await expect(precisionCad).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('tab', { name: 'Inspector' })).toHaveAttribute('aria-selected', 'true');

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
