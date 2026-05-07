import { defineConfig, devices } from '@playwright/test';

const isCi = !!process.env.CI;
/** CI uses a dedicated port so E2E does not collide with another app on :3000. */
const e2ePort = process.env.E2E_PORT ?? (isCi ? '3333' : '3000');
const defaultOrigin = `http://127.0.0.1:${e2ePort}`;
const baseURL = process.env.E2E_BASE_URL ?? defaultOrigin;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'html',

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
  },

  /** CI에서는 chromium만(동일 스펙 이중 실행·웹서버 부담 감소). 로컬은 모바일 회귀 포함. */
  projects: isCi
    ? [
        {
          name: 'chromium',
          use: {
            ...devices['Desktop Chrome'],
            launchOptions: {
              args: [
                '--disable-dev-shm-usage',
                '--enable-unsafe-swiftshader',
                '--ignore-gpu-blocklist',
              ],
            },
          },
        },
      ]
    : [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        { name: 'mobile-chrome', use: { ...devices['Pixel 5'] } },
      ],

  /**
   * `next.config` 가 웹에서 `output: 'standalone'` 이므로 CI E2E는 공식 경로대로
   * `node .next/standalone/server.js` 로 기동한다 (`next start` 는 standalone 에서 비권장).
   * 프로덕션 서버는 `startup-validation` 때문에 JWT/ADMIN/SITE URL 이 필요하므로 CI 전용 기본값을 넣는다.
   */
  webServer: isCi ? {
    command: 'npm run build && node .next/standalone/server.js',
    url: baseURL,
    reuseExistingServer: process.env.PW_REUSE_DEV === '1',
    timeout: 600_000,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: e2ePort,
      HOSTNAME: '127.0.0.1',
      JWT_SECRET:
        process.env.JWT_SECRET ??
        'e2e-jwt-secret-placeholder-must-be-at-least-32-characters-long',
      ADMIN_SECRET: process.env.ADMIN_SECRET ?? 'e2e-admin-secret-16',
      NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL ?? defaultOrigin,
      /**
       * Lang layout always loads `recaptcha/api.js?render=…`. A real production key
       * rejects localhost / 127.0.0.1 and leaves shape-generator on “Loading 3D workspace…”.
       * Google’s documented test keys always pass verification (v2/v3).
       * @see https://developers.google.com/recaptcha/docs/faq#id-like-to-run-automated-tests-with-recaptcha-what-should-i-do
       */
      NEXT_PUBLIC_RECAPTCHA_SITE_KEY: '6LeIxAcTAAAAAGG-vFI1TnRWxMZNFUojJ4WifJWe',
      RECAPTCHA_SECRET_KEY: '6LeIxAcTAAAAAGG-vFI1TnRWxMZNFUojJ4WifJWe',
      /** See `next.config.ts` — required for http://127.0.0.1 E2E static chunks. */
      CSP_OMIT_UPGRADE_INSECURE: '1',
    },
  } : undefined,
});
