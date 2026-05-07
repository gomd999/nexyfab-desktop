/**
 * GET    /api/admin/email-templates         — List all templates
 * POST   /api/admin/email-templates         — Create / upsert template
 * PATCH  /api/admin/email-templates         — Update existing template fields
 * DELETE /api/admin/email-templates?id=...  — Delete template by id
 *
 * Table: nf_email_templates
 *   id TEXT PK, name TEXT, subject TEXT, html_body TEXT,
 *   variables TEXT (JSON array), created_at INTEGER ms, updated_at INTEGER ms
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';

export const dynamic = 'force-dynamic';

interface TemplateRow {
  id: string;
  name: string;
  subject: string;
  html_body: string;
  variables: string | null;
  created_at: number;
  updated_at: number;
}

interface TemplateOut {
  id: string;
  name: string;
  subject: string;
  html_body: string;
  variables: string[];
  created_at: number;
  updated_at: number;
}

function parseTemplate(row: TemplateRow): TemplateOut {
  let variables: string[] = [];
  if (row.variables) {
    try {
      const parsed = JSON.parse(row.variables);
      if (Array.isArray(parsed)) variables = parsed.map(String);
    } catch {
      variables = [];
    }
  }
  return { ...row, variables };
}

// ── GET ────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const isAdmin = await verifyAdmin(req);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const db = getDbAdapter();

  try {
    const rows = await db.queryAll<TemplateRow>(
      `SELECT id, name, subject, html_body, variables, created_at, updated_at
       FROM nf_email_templates
       ORDER BY updated_at DESC`,
    );
    return NextResponse.json({ templates: rows.map(parseTemplate) });
  } catch (err) {
    console.error('[email-templates GET] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ── POST (create / upsert) ─────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const isAdmin = await verifyAdmin(req);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: {
    id?: string;
    name: string;
    subject: string;
    html_body: string;
    variables?: string[];
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { name, subject, html_body } = body;
  if (!name || !subject || !html_body) {
    return NextResponse.json(
      { error: 'name, subject, and html_body are required' },
      { status: 400 },
    );
  }

  const db = getDbAdapter();
  const now = Date.now();
  const id = body.id || crypto.randomUUID();
  const variables = Array.isArray(body.variables)
    ? JSON.stringify(body.variables.map(String))
    : JSON.stringify([]);

  try {
    // Upsert: insert or replace (SQLite) / ON CONFLICT handled by db-adapter
    await db.execute(
      `INSERT OR REPLACE INTO nf_email_templates
         (id, name, subject, html_body, variables, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM nf_email_templates WHERE id = ?), ?), ?)`,
      id, name, subject, html_body, variables, id, now, now,
    );

    const created = await db.queryOne<TemplateRow>(
      `SELECT id, name, subject, html_body, variables, created_at, updated_at
       FROM nf_email_templates WHERE id = ?`,
      id,
    );

    return NextResponse.json(
      { template: created ? parseTemplate(created) : null },
      { status: 201 },
    );
  } catch (err) {
    console.error('[email-templates POST] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ── PATCH (partial update) ─────────────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  const isAdmin = await verifyAdmin(req);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: {
    id: string;
    name?: string;
    subject?: string;
    html_body?: string;
    variables?: string[];
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const db = getDbAdapter();

  // Check template exists
  const existing = await db.queryOne<TemplateRow>(
    `SELECT id FROM nf_email_templates WHERE id = ?`,
    body.id,
  );
  if (!existing) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  // Build dynamic SET clause
  const setClauses: string[] = [];
  const args: (string | number)[] = [];

  if (body.name !== undefined) {
    setClauses.push('name = ?');
    args.push(body.name);
  }
  if (body.subject !== undefined) {
    setClauses.push('subject = ?');
    args.push(body.subject);
  }
  if (body.html_body !== undefined) {
    setClauses.push('html_body = ?');
    args.push(body.html_body);
  }
  if (body.variables !== undefined) {
    setClauses.push('variables = ?');
    args.push(
      Array.isArray(body.variables)
        ? JSON.stringify(body.variables.map(String))
        : JSON.stringify([]),
    );
  }

  if (setClauses.length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  const now = Date.now();
  setClauses.push('updated_at = ?');
  args.push(now);
  args.push(body.id);

  try {
    await db.execute(
      `UPDATE nf_email_templates SET ${setClauses.join(', ')} WHERE id = ?`,
      ...args,
    );

    const updated = await db.queryOne<TemplateRow>(
      `SELECT id, name, subject, html_body, variables, created_at, updated_at
       FROM nf_email_templates WHERE id = ?`,
      body.id,
    );

    return NextResponse.json({ template: updated ? parseTemplate(updated) : null });
  } catch (err) {
    console.error('[email-templates PATCH] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ── DELETE ─────────────────────────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const isAdmin = await verifyAdmin(req);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const id = req.nextUrl.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id query param is required' }, { status: 400 });
  }

  const db = getDbAdapter();

  try {
    const result = await db.execute(
      `DELETE FROM nf_email_templates WHERE id = ?`,
      id,
    );

    if (result.changes === 0) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    return NextResponse.json({ deleted: id });
  } catch (err) {
    console.error('[email-templates DELETE] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
