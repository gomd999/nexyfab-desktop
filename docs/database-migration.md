# Database Migration Guide: SQLite → Turso

## Current Setup
better-sqlite3 (synchronous SQLite, single-node)

## When to Migrate
- > 1,000 concurrent users
- Multi-region deployment needed
- > 10GB database size

## Migration to Turso (Recommended)

Turso is distributed SQLite — minimal code changes required.

### 1. Install
```bash
npm install @libsql/client
```

### 2. Set env vars
```
TURSO_DATABASE_URL=libsql://your-db.turso.io
TURSO_AUTH_TOKEN=your-token
```

### 3. Update db-adapter.ts
Replace BetterSqliteAdapter with TursoAdapter:
```typescript
import { createClient } from '@libsql/client';

class TursoAdapter implements DbAdapter {
  private client = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.client.execute({ sql, args: params as any[] });
    return result.rows as unknown as T[];
  }
  // ... etc
}
```

Note: Turso adapter is async — all callers need `await`.

### 4. Run migration
Export SQLite data and import to Turso:
```bash
turso db shell your-db < data/nexyfab.db
```

## Migration to PostgreSQL (Full Migration)

Use Supabase, Neon, or self-hosted PostgreSQL.
Requires rewriting all SQL queries (PostgreSQL syntax differs from SQLite).
Estimated effort: 2-3 weeks.
