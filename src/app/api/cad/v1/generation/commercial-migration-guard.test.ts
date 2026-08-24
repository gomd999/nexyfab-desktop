// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { commercialPostgresMigrationAtLeast } from '@/lib/commercial-readiness';

const guardedRoutes = [
  'advance/route.ts',
  'state/route.ts',
  'refine/route.ts',
  'finalize/route.ts',
  'commercial-receipts/requests/route.ts',
  '../../../internal/commercial-verifier/callback/route.ts',
] as const;

describe('commercial generation migration compatibility', () => {
  it('accepts registered later migrations while rejecting stale or unknown versions', () => {
    expect(commercialPostgresMigrationAtLeast({ POSTGRES_MIGRATION_VERSION: '2026082208' }, 2026082208)).toBe(true);
    expect(commercialPostgresMigrationAtLeast({ POSTGRES_MIGRATION_VERSION: '2026082403' }, 2026082208)).toBe(true);
    expect(commercialPostgresMigrationAtLeast({ POSTGRES_MIGRATION_VERSION: '2026082207' }, 2026082208)).toBe(false);
    expect(commercialPostgresMigrationAtLeast({ POSTGRES_MIGRATION_VERSION: '99999999' }, 2026082208)).toBe(false);
  });

  it.each(guardedRoutes)('%s uses the shared ordered migration guard', (relativePath) => {
    const source = readFileSync(resolve(__dirname, relativePath), 'utf8');
    expect(source).toContain('commercialPostgresMigrationAtLeast(process.env, 2026082208)');
    expect(source).not.toMatch(/POSTGRES_MIGRATION_VERSION\s*!==\s*['\"]2026082208['\"]/);
  });
});
