/**
 * 스키마 드리프트 — **SQLite 에만 추가하고 운영(Postgres)에는 안 만든 컬럼**을 잡는다 (260801).
 *
 * ## 왜 이 검사가 있어야 하는가
 * 운영 Postgres 스키마는 **오직** `db-postgres-migrations.sql` 에서만 만들어진다
 * (`db-adapter.initPostgresSchema`). `db.ts` 의 `MIGRATIONS` 배열은 SQLite 전용이다.
 * 그런데 새 컬럼을 추가할 때 db.ts 쪽만 고치기 쉽다 — 로컬에서는 전부 통과하고
 * **운영에서만 터진다.**
 *
 * 실제로 그렇게 됐다: 마이그레이션 76 이 `plan_expires_at` / `plan_fallback` 을 db.ts 에만
 * 추가했고, `auth-middleware.enrichAuthUser` 는 **인증된 모든 요청마다** 그 둘을 SELECT 한다.
 * 260801 실측에서 122개 중 24개가 어긋나 있었다.
 *
 * ## ⚠ 이 검사는 자기 자신을 먼저 의심한다
 * 처음 이 드리프트를 잴 때 인라인 정규식이 뭉개져 **122/122 누락**이라는 거짓 결과가 나왔다.
 * 전부 누락이라는 답은 도구가 틀렸다는 신호다. 그래서 아래에 **자기검사**를 먼저 둔다 —
 * 확실히 존재하는 컬럼을 존재한다고 못 하면, 드리프트 0 이라는 결과도 믿을 수 없다.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = join(process.cwd(), 'src', 'lib');
const pgSql = readFileSync(join(DIR, 'db-postgres-migrations.sql'), 'utf8');
const dbTs = readFileSync(join(DIR, 'db.ts'), 'utf8');

/** Postgres 파일이 실제로 정의하는 `테이블.컬럼` 집합. */
function postgresColumns(): Set<string> {
  const cols = new Set<string>();
  // ① CREATE TABLE 본문 — 괄호 균형으로 자른다(정규식으로 끊으면 중첩에서 틀린다)
  for (const m of pgSql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(\w+)\s*\(/gi)) {
    const table = m[1]!;
    let depth = 0;
    let i = m.index! + m[0].length - 1;
    const start = i + 1;
    for (; i < pgSql.length; i++) {
      if (pgSql[i] === '(') depth++;
      else if (pgSql[i] === ')') { depth--; if (depth === 0) break; }
    }
    for (const line of pgSql.slice(start, i).split('\n')) {
      const c = line.trim().match(/^(\w+)\s+[A-Za-z]/);
      if (c && !/^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)$/i.test(c[1]!)) cols.add(`${table}.${c[1]}`);
    }
  }
  // ② ALTER TABLE … ADD COLUMN
  for (const m of pgSql.matchAll(/ALTER TABLE (\w+)\s+ADD COLUMN\s+(?:IF NOT EXISTS\s+)?(\w+)/gi)) {
    cols.add(`${m[1]}.${m[2]}`);
  }
  return cols;
}

/** db.ts 마이그레이션이 추가하는 `테이블.컬럼` 집합. */
function sqliteAlterColumns(): Set<string> {
  const cols = new Set<string>();
  for (const m of dbTs.matchAll(/ALTER TABLE (\w+)\s+ADD COLUMN\s+(?:IF NOT EXISTS\s+)?(\w+)/gi)) {
    cols.add(`${m[1]}.${m[2]}`);
  }
  return cols;
}

/** Postgres 에 CREATE TABLE 이 있는 테이블. */
function postgresTables(): Set<string> {
  const t = new Set<string>();
  for (const m of pgSql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(\w+)/gi)) t.add(m[1]!);
  return t;
}

/**
 * 알면서 두는 예외.
 * ⚠ 여기에 넣는 것은 「괜찮다」가 아니라 **「알고 있고 이유가 있다」**는 뜻이다.
 *   이유 없이 추가하면 이 검사는 의미를 잃는다.
 */
const KNOWN_GAPS: Record<string, string> = {
  'nf_factories.partner_email': 'nf_factories 는 Postgres 에 CREATE TABLE 자체가 없다',
  'nf_factories.tech_exp': '동상',
  'nf_factories.match_field': '동상',
  'nf_factories.capacity_amount': '동상',
  'nf_factories.partner_type': '동상',
};

describe('★검사 도구를 먼저 의심한다', () => {
  it('★확실히 존재하는 컬럼을 존재한다고 판정한다 — 못 하면 드리프트 0 도 못 믿는다', () => {
    const cols = postgresColumns();
    for (const probe of ['nf_users.id', 'nf_users.email', 'nf_users.role', 'nf_users.services', 'nf_users.pro_grace_until', 'nf_users.subscription_ends_at']) {
      expect(cols.has(probe), `${probe} 를 못 찾았다 — 파서가 고장났다`).toBe(true);
    }
  });

  it('★없는 컬럼을 있다고 하지 않는다 — 과탐이면 드리프트를 놓친다', () => {
    const cols = postgresColumns();
    expect(cols.has('nf_users.이런컬럼은없다')).toBe(false);
    expect(cols.has('없는테이블.id')).toBe(false);
  });

  it('양쪽 집합이 비어 있지 않다 — 파일을 못 읽으면 공허하게 통과한다', () => {
    expect(postgresColumns().size).toBeGreaterThan(500);
    expect(sqliteAlterColumns().size).toBeGreaterThan(50);
  });
});

describe('★SQLite 에만 추가된 컬럼이 없다', () => {
  it('★db.ts 가 추가하는 모든 컬럼이 Postgres 스키마에도 있다', () => {
    const pg = postgresColumns();
    const drift = [...sqliteAlterColumns()].filter((c) => !pg.has(c) && !(c in KNOWN_GAPS));
    expect(drift, `운영(Postgres)에 없는 컬럼: ${drift.join(', ')}\n→ db-postgres-migrations.sql 에 ALTER TABLE … ADD COLUMN IF NOT EXISTS 를 추가할 것`).toEqual([]);
  });

  it('★인증 경로가 읽는 컬럼은 반드시 있어야 한다 — 없으면 로그인한 모든 요청이 죽는다', () => {
    const pg = postgresColumns();
    for (const c of ['nf_users.plan_expires_at', 'nf_users.plan_fallback', 'nf_users.pro_grace_until', 'nf_users.role', 'nf_users.email_verified']) {
      expect(pg.has(c), `${c} 없음 — auth-middleware.enrichAuthUser 가 매 요청 SELECT 한다`).toBe(true);
    }
  });
});

describe('★없는 테이블에 ALTER 를 걸지 않는다', () => {
  it('★ALTER 대상 테이블이 모두 Postgres 에 존재한다 — 하나라도 없으면 스키마 초기화 전체가 중단된다', () => {
    const tables = postgresTables();
    const bad: string[] = [];
    for (const m of pgSql.matchAll(/ALTER TABLE (\w+)\s+ADD COLUMN/gi)) {
      if (!tables.has(m[1]!)) bad.push(m[1]!);
    }
    expect([...new Set(bad)], 'CREATE TABLE 없이 ALTER 되는 테이블').toEqual([]);
  });
});

describe('예외 목록', () => {
  it('★예외는 실제로 어긋나 있는 것만 담는다 — 해결된 항목이 남으면 목록을 못 믿는다', () => {
    const pg = postgresColumns();
    const stale = Object.keys(KNOWN_GAPS).filter((c) => pg.has(c));
    expect(stale, `이미 해결됐는데 예외에 남아 있음: ${stale.join(', ')}`).toEqual([]);
  });

  it('모든 예외에 이유가 적혀 있다', () => {
    for (const [k, why] of Object.entries(KNOWN_GAPS)) {
      expect(why.trim().length, `${k} 에 이유가 없다`).toBeGreaterThan(0);
    }
  });
});
