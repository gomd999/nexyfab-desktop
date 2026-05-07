/**
 * Prompt library — saved JSCAD/AI prompts that users can reuse later.
 *
 * GET  /api/nexyfab/prompt-library?scope=personal|org
 *      - personal: prompts owned by caller
 *      - org:      prompts shared with any org caller belongs to
 *      - omitted:  both, sorted by updated_at desc
 *
 * POST /api/nexyfab/prompt-library
 *      Body: { scope: 'personal'|'org', orgId?, title, prompt, description? }
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';

export const dynamic = 'force-dynamic';

interface PromptRow {
  id: string;
  scope: string;
  org_id: string | null;
  owner_id: string;
  title: string;
  prompt: string;
  description: string | null;
  created_at: number;
  updated_at: number;
}

export interface PromptLibraryEntry {
  id: string;
  scope: 'personal' | 'org';
  orgId: string | null;
  ownerId: string;
  title: string;
  prompt: string;
  description: string | null;
  createdAt: number;
  updatedAt: number;
  /** True when the calling user is the original author. */
  isMine: boolean;
}

async function ensureTable(db: ReturnType<typeof getDbAdapter>) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS nf_prompt_library (
      id          TEXT PRIMARY KEY,
      scope       TEXT NOT NULL DEFAULT 'personal',
      org_id      TEXT,
      owner_id    TEXT NOT NULL,
      title       TEXT NOT NULL,
      prompt      TEXT NOT NULL,
      description TEXT,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    )
  `).catch(() => {});
  await db.execute('CREATE INDEX IF NOT EXISTS idx_prompt_lib_owner ON nf_prompt_library(owner_id)').catch(() => {});
  await db.execute('CREATE INDEX IF NOT EXISTS idx_prompt_lib_org ON nf_prompt_library(org_id) WHERE org_id IS NOT NULL').catch(() => {});
}

function rowToEntry(row: PromptRow, callerId: string): PromptLibraryEntry {
  return {
    id: row.id,
    scope: row.scope === 'org' ? 'org' : 'personal',
    orgId: row.org_id,
    ownerId: row.owner_id,
    title: row.title,
    prompt: row.prompt,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isMine: row.owner_id === callerId,
  };
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDbAdapter();
  await ensureTable(db);

  const scope = req.nextUrl.searchParams.get('scope');
  const orgIds = authUser.orgIds;

  let rows: PromptRow[] = [];
  if (scope === 'personal') {
    rows = await db.queryAll<PromptRow>(
      `SELECT * FROM nf_prompt_library
        WHERE scope = 'personal' AND owner_id = ?
        ORDER BY updated_at DESC`,
      authUser.userId,
    );
  } else if (scope === 'org') {
    if (orgIds.length === 0) return NextResponse.json({ entries: [] });
    const placeholders = orgIds.map(() => '?').join(',');
    rows = await db.queryAll<PromptRow>(
      `SELECT * FROM nf_prompt_library
        WHERE scope = 'org' AND org_id IN (${placeholders})
        ORDER BY updated_at DESC`,
      ...orgIds,
    );
  } else {
    // Both — personal owned by caller plus org-shared in caller's orgs
    const placeholders = orgIds.length > 0 ? orgIds.map(() => '?').join(',') : null;
    const sql = placeholders
      ? `SELECT * FROM nf_prompt_library
           WHERE (scope = 'personal' AND owner_id = ?)
              OR (scope = 'org' AND org_id IN (${placeholders}))
           ORDER BY updated_at DESC`
      : `SELECT * FROM nf_prompt_library
           WHERE scope = 'personal' AND owner_id = ?
           ORDER BY updated_at DESC`;
    const args = placeholders ? [authUser.userId, ...orgIds] : [authUser.userId];
    rows = await db.queryAll<PromptRow>(sql, ...args);
  }

  return NextResponse.json({
    entries: rows.map((r) => rowToEntry(r, authUser.userId)),
  });
}

// ─── POST ─────────────────────────────────────────────────────────────────────

interface CreateBody {
  scope?: unknown;
  orgId?: unknown;
  title?: unknown;
  prompt?: unknown;
  description?: unknown;
}

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({})) as CreateBody;

  const scope = body.scope === 'org' ? 'org' : 'personal';
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const orgId = typeof body.orgId === 'string' ? body.orgId : null;

  if (!title || title.length > 120) {
    return NextResponse.json({ error: 'title is required (1-120 chars)' }, { status: 400 });
  }
  if (!prompt || prompt.length > 4000) {
    return NextResponse.json({ error: 'prompt is required (1-4000 chars)' }, { status: 400 });
  }
  if (description.length > 500) {
    return NextResponse.json({ error: 'description too long (max 500)' }, { status: 400 });
  }
  if (scope === 'org') {
    if (!orgId) return NextResponse.json({ error: 'orgId required for org scope' }, { status: 400 });
    if (!authUser.orgIds.includes(orgId)) {
      return NextResponse.json({ error: 'Not a member of that org' }, { status: 403 });
    }
  }

  const db = getDbAdapter();
  await ensureTable(db);

  const id = `pl-${randomBytes(6).toString('hex')}`;
  const now = Date.now();
  await db.execute(
    `INSERT INTO nf_prompt_library
      (id, scope, org_id, owner_id, title, prompt, description, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, scope, scope === 'org' ? orgId : null, authUser.userId,
    title, prompt, description || null, now, now,
  );

  const entry: PromptLibraryEntry = {
    id, scope, orgId: scope === 'org' ? orgId : null, ownerId: authUser.userId,
    title, prompt, description: description || null,
    createdAt: now, updatedAt: now, isMine: true,
  };
  return NextResponse.json({ entry }, { status: 201 });
}
