import { describe, expect, it } from 'vitest';
import { missingPostgresSchemaObjects, POSTGRES_REQUIRED_TABLES } from './db-adapter';

describe('PostgreSQL production schema verification', () => {
  it('passes when all required runtime tables exist', () => {
    expect(missingPostgresSchemaObjects([...POSTGRES_REQUIRED_TABLES])).toEqual([]);
  });

  it('reports missing critical tables deterministically', () => {
    const existing = POSTGRES_REQUIRED_TABLES.filter(table => table !== 'partner_applications');
    expect(missingPostgresSchemaObjects(existing)).toEqual(['partner_applications']);
  });

  it('normalizes table names without accepting unrelated tables', () => {
    expect(missingPostgresSchemaObjects(['NF_USERS', 'unrelated'])).toContain('nf_projects');
    expect(missingPostgresSchemaObjects(['NF_USERS', 'unrelated'])).not.toContain('nf_users');
  });
});
