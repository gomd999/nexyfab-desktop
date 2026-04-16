// src/lib/config.ts
// 서버 시작 시 필수 환경변수를 검증합니다.
// Next.js는 Edge/Node 모두에서 실행될 수 있으므로 런타임 체크로 처리합니다.

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val && process.env.NODE_ENV === 'production') {
    throw new Error(`[FATAL] Missing required environment variable: ${key}`);
  }
  return val ?? '';
}

function optionalEnv(key: string, defaultValue = ''): string {
  return process.env[key] ?? defaultValue;
}

export const config = {
  env: (process.env.NODE_ENV ?? 'development') as 'development' | 'production' | 'test',
  isProd: process.env.NODE_ENV === 'production',
  isDev: process.env.NODE_ENV !== 'production',

  jwt: {
    secret: optionalEnv('JWT_SECRET', 'nexyfab-dev-secret-change-in-production'),
    expiresIn: parseInt(optionalEnv('JWT_EXPIRES_IN', String(7 * 24 * 3600)), 10),
  },

  db: {
    path: optionalEnv('NEXYFAB_DB_PATH', './nexyfab.db'),
  },

  smtp: {
    host: optionalEnv('SMTP_HOST'),
    port: parseInt(optionalEnv('SMTP_PORT', '587'), 10),
    user: optionalEnv('SMTP_USER'),
    pass: optionalEnv('SMTP_PASS'),
    from: optionalEnv('SMTP_FROM', 'noreply@nexyfab.com'),
  },

  auth: {
    nexysysUrl: optionalEnv('NEXYSYS_AUTH_URL'),
    allowDemoAuth: optionalEnv('ALLOW_DEMO_AUTH') === 'true' || optionalEnv('NODE_ENV') === 'development',
    allowedOrigins: optionalEnv('ALLOWED_ORIGINS')
      .split(',')
      .map(o => o.trim())
      .filter(Boolean),
  },

  app: {
    siteUrl: optionalEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000'),
    adminEmail: optionalEnv('ADMIN_EMAIL', 'admin@nexyfab.com'),
  },
} as const;

// 프로덕션에서만 필수 항목 검증
if (process.env.NODE_ENV === 'production') {
  const missing: string[] = [];
  if (!process.env.JWT_SECRET) missing.push('JWT_SECRET');
  if (!process.env.SMTP_HOST) missing.push('SMTP_HOST');
  if (missing.length > 0) {
    console.error(`[CONFIG] Missing required env vars: ${missing.join(', ')}`);
    // 빌드는 허용하되 런타임에 로그만
  }
}
