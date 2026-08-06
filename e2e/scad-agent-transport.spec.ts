import { test, expect, request as requestFactory } from '@playwright/test';
import { authenticatedRequest } from './helpers/auth';

test('authenticated AI panel transport returns governed SSE events', async ({ baseURL }) => {
  test.setTimeout(120_000);
  expect(baseURL).toBeTruthy();
  const bootstrap = await requestFactory.newContext({ baseURL });
  const auth = await authenticatedRequest(bootstrap, baseURL!);
  await bootstrap.dispose();
  test.skip(!auth, 'signup unavailable (rate limit or environment)');
  try {
    const response = await auth!.context.post('/api/nexyfab/scad-agent/', {
      headers: { Accept: 'text/event-stream, application/json' },
      data: { userPrompt: 'Create a 30 mm cube as a parametric solid.' },
      timeout: 90_000,
    });
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/event-stream');
    const wire = await response.text();
    expect(wire).toMatch(/"type"\s*:\s*"(?:model_response|awaiting_user|error)"/);
    expect(wire).not.toContain('userPrompt is required');
  } finally {
    await auth!.context.dispose();
  }
});
