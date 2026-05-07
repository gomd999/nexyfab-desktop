/**
 * Startup validation — called once when the server starts.
 * Validates required environment variables and fails fast if misconfigured.
 * Only runs in production (NODE_ENV === 'production').
 */

interface EnvCheck {
  key: string;
  required: boolean;
  validate?: (value: string) => boolean;
  hint?: string;
}

const ENV_CHECKS: EnvCheck[] = [
  {
    key: 'JWT_SECRET',
    required: true,
    validate: (v) => v.length >= 32,
    hint: 'Must be at least 32 characters. Generate with: openssl rand -base64 32',
  },
  {
    key: 'ADMIN_SECRET',
    required: true,
    validate: (v) => v.length >= 16,
    hint: 'Must be at least 16 characters.',
  },
  {
    key: 'NEXT_PUBLIC_SITE_URL',
    required: true,
    validate: (v) => v.startsWith('https://') || v.startsWith('http://'),
    hint: 'Must be a full URL, e.g., https://nexyfab.com',
  },
  {
    key: 'SMTP_HOST',
    required: false,
    hint: 'Required for email features (password reset, notifications).',
  },
  {
    key: 'STRIPE_SECRET_KEY',
    required: false,
    validate: (v) => v.startsWith('sk_'),
    hint: 'Must start with sk_. Required for billing features.',
  },
  {
    key: 'STRIPE_WEBHOOK_SECRET',
    required: false,
    validate: (v) => v.startsWith('whsec_'),
    hint: 'Must start with whsec_. Required for Stripe webhooks.',
  },
  {
    key: 'AIRWALLEX_WEBHOOK_SECRET',
    required: false,
    hint: 'Required for Airwallex payment webhooks. Without this, payment events are unverified.',
  },
  {
    key: 'DATABASE_URL',
    required: false,
    validate: (v) => v.startsWith('postgres'),
    hint: 'PostgreSQL connection string. If not set, SQLite is used (not recommended for production).',
  },
  {
    key: 'REDIS_URL',
    required: false,
    validate: (v) => v.startsWith('redis'),
    hint: 'Redis URL for distributed rate limiting. If not set, in-memory rate limiting is used.',
  },
  {
    key: 'S3_BUCKET',
    required: false,
    hint: 'S3 bucket for file uploads. If not set, local filesystem is used.',
  },
  {
    key: 'ADMIN_PASSWORD_HASH',
    required: false,
    validate: (v) => v.startsWith('$2'),
    hint: 'bcrypt hash of admin password. Generate with: node -e "require(\'bcryptjs\').hash(\'password\',12).then(console.log)"',
  },
];

export function validateStartup(): void {
  // Only validate in production, and skip during `next build` (page data collection phase)
  if (process.env.NODE_ENV !== 'production') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;

  const errors: string[] = [];
  const warnings: string[] = [];

  for (const check of ENV_CHECKS) {
    const value = process.env[check.key];

    if (!value) {
      if (check.required) {
        errors.push(`❌ Missing required env var: ${check.key}${check.hint ? `\n   Hint: ${check.hint}` : ''}`);
      } else {
        warnings.push(`⚠️  Optional env var not set: ${check.key}${check.hint ? ` (${check.hint})` : ''}`);
      }
      continue;
    }

    if (check.validate && !check.validate(value)) {
      if (check.required) {
        errors.push(`❌ Invalid value for ${check.key}${check.hint ? `\n   Hint: ${check.hint}` : ''}`);
      } else {
        warnings.push(`⚠️  Invalid value for optional ${check.key}: ${check.hint ?? ''}`);
      }
    }
  }

  // Warn about missing production infrastructure
  if (!process.env.DATABASE_URL) {
    warnings.push('⚠️  DATABASE_URL not set — using SQLite. Not recommended for production (no horizontal scaling).');
  }
  if (!process.env.REDIS_URL) {
    warnings.push(
      '⚠️  REDIS_URL not set — using in-memory rate limiting. On Railway with multiple instances or replicas, limits are per-instance; set REDIS_URL for accurate limits.',
    );
  }
  if (!process.env.S3_BUCKET) {
    warnings.push('⚠️  S3_BUCKET not set — using local filesystem for uploads. Files are publicly accessible.');
  }

  // Detect default/development secrets in production
  const dangerousDefaults = [
    ['JWT_SECRET', 'nexyfab-dev-secret-change-in-production'],
    ['JWT_SECRET', 'nexyfab-dev-secret-change-in-production-32ch'],
    ['JWT_SECRET', 'change-me'],
    ['ADMIN_SECRET', 'local-admin-secret-replace-in-prod'],
    ['ADMIN_SECRET', 'change-me'],
    ['UNSUBSCRIBE_SECRET', 'nexyfab-unsub-secret'],
  ];

  for (const [key, defaultVal] of dangerousDefaults) {
    if (process.env[key] === defaultVal) {
      errors.push(`❌ SECURITY: ${key} is set to default development value. Change immediately!`);
    }
  }

  if (warnings.length > 0) {
    console.warn('\n[NexyFab Startup] Configuration warnings:');
    warnings.forEach(w => console.warn(' ', w));
  }

  if (errors.length > 0) {
    console.error('\n[NexyFab Startup] FATAL: Configuration errors:');
    errors.forEach(e => console.error(' ', e));
    console.error('\nServer cannot start with invalid configuration.\n');
    process.exit(1);
  }

  console.log('[NexyFab Startup] Environment validation passed ✓');
}
