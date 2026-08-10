// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('recaptcha client', () => {
  beforeEach(() => {
    vi.resetModules();
    document.head.innerHTML = '';
    delete window.grecaptcha;
  });

  it('does not add the Google script until explicitly requested', async () => {
    await import('./recaptcha-client');
    expect(document.querySelector('script[src*="recaptcha/api.js"]')).toBeNull();
  });

  it('reuses an available API and executes the requested action', async () => {
    const execute = vi.fn().mockResolvedValue('token-1');
    window.grecaptcha = { ready: callback => callback(), execute };
    const { executeRecaptchaV3 } = await import('./recaptcha-client');

    await expect(executeRecaptchaV3('partner_register', 'site-key')).resolves.toBe('token-1');
    expect(execute).toHaveBeenCalledWith('site-key', { action: 'partner_register' });
    expect(document.querySelector('script[src*="recaptcha/api.js"]')).toBeNull();
  });

  it('rejects invalid actions before loading a third-party script', async () => {
    const { executeRecaptchaV3 } = await import('./recaptcha-client');
    await expect(executeRecaptchaV3('bad action!', 'site-key')).rejects.toThrow('Invalid reCAPTCHA action');
    expect(document.querySelector('script[src*="recaptcha/api.js"]')).toBeNull();
  });
});
