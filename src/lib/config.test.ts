// Unit tests for config
// NOTE: config.ts exports only the `config` object; requireEnv/optionalEnv are
// private helpers.  We test observable behaviour through the exported config
// object and by re-importing the module with manipulated process.env.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('config module', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  // -------------------------------------------------------------------------
  // optionalEnv behaviour (observable through config object)
  // -------------------------------------------------------------------------

  it('uses the default JWT_EXPIRES_IN when env var is absent', async () => {
    delete process.env.JWT_EXPIRES_IN;
    const { config } = await import('./config');
    // default = 7 * 24 * 3600 = 604800
    expect(config.jwt.expiresIn).toBe(7 * 24 * 3600);
  });

  it('reads JWT_EXPIRES_IN from env when set', async () => {
    process.env.JWT_EXPIRES_IN = '3600';
    const { config } = await import('./config');
    expect(config.jwt.expiresIn).toBe(3600);
  });

  it('falls back to default db path when NEXYFAB_DB_PATH is absent', async () => {
    delete process.env.NEXYFAB_DB_PATH;
    const { config } = await import('./config');
    expect(config.db.path).toBe('./nexyfab.db');
  });

  it('reads NEXYFAB_DB_PATH from env when set', async () => {
    process.env.NEXYFAB_DB_PATH = '/data/production.db';
    const { config } = await import('./config');
    expect(config.db.path).toBe('/data/production.db');
  });

  it('returns empty string for optional SMTP_HOST when not set', async () => {
    delete process.env.SMTP_HOST;
    const { config } = await import('./config');
    expect(config.smtp.host).toBe('');
  });

  it('defaults siteUrl to http://localhost:3000 when NEXT_PUBLIC_SITE_URL is absent', async () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    const { config } = await import('./config');
    expect(config.app.siteUrl).toBe('http://localhost:3000');
  });

  it('reads NEXT_PUBLIC_SITE_URL when set', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://app.nexyfab.com';
    const { config } = await import('./config');
    expect(config.app.siteUrl).toBe('https://app.nexyfab.com');
  });

  // -------------------------------------------------------------------------
  // requireEnv behaviour: only throws in production
  // -------------------------------------------------------------------------

  it('does NOT throw for missing JWT_SECRET in test environment', async () => {
    delete process.env.JWT_SECRET;
    // NODE_ENV=test — importing config must not throw
    await expect(import('./config')).resolves.toBeDefined();
  });

  it('does NOT throw for missing JWT_SECRET in development environment', async () => {
    delete process.env.JWT_SECRET;
    Object.defineProperty(process.env, 'NODE_ENV', { value: 'development', writable: true, configurable: true });
    await expect(import('./config')).resolves.toBeDefined();
  });

  // -------------------------------------------------------------------------
  // isProd / isDev flags
  // -------------------------------------------------------------------------

  it('isProd is false and isDev is true in test environment', async () => {
    // NODE_ENV is 'test' (set by vitest)
    const { config } = await import('./config');
    expect(config.isProd).toBe(false);
    expect(config.isDev).toBe(true);
  });

  // -------------------------------------------------------------------------
  // ALLOWED_ORIGINS parsing
  // -------------------------------------------------------------------------

  it('parses ALLOWED_ORIGINS as a trimmed, filtered array', async () => {
    process.env.ALLOWED_ORIGINS = ' https://a.com , https://b.com , ';
    const { config } = await import('./config');
    expect(config.auth.allowedOrigins).toEqual(['https://a.com', 'https://b.com']);
  });

  it('returns empty array when ALLOWED_ORIGINS is not set', async () => {
    delete process.env.ALLOWED_ORIGINS;
    const { config } = await import('./config');
    expect(config.auth.allowedOrigins).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // allowDemoAuth flag
  // -------------------------------------------------------------------------

  it('allowDemoAuth is true when ALLOW_DEMO_AUTH=true', async () => {
    process.env.ALLOW_DEMO_AUTH = 'true';
    Object.defineProperty(process.env, 'NODE_ENV', { value: 'test', writable: true, configurable: true });
    const { config } = await import('./config');
    expect(config.auth.allowDemoAuth).toBe(true);
  });

  it('allowDemoAuth is false when ALLOW_DEMO_AUTH is unset and NODE_ENV is test', async () => {
    delete process.env.ALLOW_DEMO_AUTH;
    Object.defineProperty(process.env, 'NODE_ENV', { value: 'test', writable: true, configurable: true });
    const { config } = await import('./config');
    expect(config.auth.allowDemoAuth).toBe(false);
  });
});
