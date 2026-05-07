import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';

export const dynamic = 'force-dynamic';

type TemplateRow = {
  id: string; name: string; category: string; content: string;
  variables: string; created_at: string; updated_at: string;
};

function rowToTemplate(r: TemplateRow) {
  return {
    id: r.id, name: r.name, category: r.category, content: r.content,
    variables: JSON.parse(r.variables) as string[],
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function extractVariables(content: string): string[] {
  const matches = content.matchAll(/\{\{(\w+)\}\}/g);
  const vars = new Set<string>();
  for (const m of matches) vars.add(m[1]);
  return Array.from(vars);
}

// GET /api/templates
export async function GET() {
  const db = getDbAdapter();
  const rows = await db.queryAll<TemplateRow>(
    'SELECT * FROM nf_email_templates ORDER BY created_at DESC',
  ).catch((): TemplateRow[] => []);
  return NextResponse.json({ templates: rows.map(rowToTemplate) });
}

// POST /api/templates — 생성 (admin only)
export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!(await verifyAdmin(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json();
  const { name, category, content } = body;

  if (!name || !content) {
    return NextResponse.json({ error: 'name과 content는 필수입니다.' }, { status: 400 });
  }

  const db = getDbAdapter();
  const id = `TPL-${Date.now()}`;
  const now = new Date().toISOString();
  const vars = extractVariables(content);

  await db.execute(
    `INSERT INTO nf_email_templates (id, name, category, content, variables, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?)`,
    id, name, category || '일반', content, JSON.stringify(vars), now, now,
  );

  return NextResponse.json({
    template: { id, name, category: category || '일반', content, variables: vars, createdAt: now, updatedAt: now },
  }, { status: 201 });
}

// PATCH /api/templates — 수정 (admin only)
export async function PATCH(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!(await verifyAdmin(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json();
  const { id, name, category, content } = body;

  if (!id) {
    return NextResponse.json({ error: 'id는 필수입니다.' }, { status: 400 });
  }

  const db = getDbAdapter();
  const existing = await db.queryOne<TemplateRow>(
    'SELECT * FROM nf_email_templates WHERE id = ?', id,
  ).catch(() => null);
  if (!existing) return NextResponse.json({ error: '템플릿을 찾을 수 없습니다.' }, { status: 404 });

  const updatedName = name ?? existing.name;
  const updatedCategory = category ?? existing.category;
  const updatedContent = content ?? existing.content;
  const vars = extractVariables(updatedContent);
  const now = new Date().toISOString();

  await db.execute(
    `UPDATE nf_email_templates SET name=?, category=?, content=?, variables=?, updated_at=? WHERE id=?`,
    updatedName, updatedCategory, updatedContent, JSON.stringify(vars), now, id,
  );

  return NextResponse.json({
    template: {
      id, name: updatedName, category: updatedCategory, content: updatedContent,
      variables: vars, createdAt: existing.created_at, updatedAt: now,
    },
  });
}

// DELETE /api/templates?id=xxx (admin only)
export async function DELETE(req: NextRequest) {
  if (!(await verifyAdmin(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const id = req.nextUrl.searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'id는 필수입니다.' }, { status: 400 });
  }

  const db = getDbAdapter();
  const result = await db.execute('DELETE FROM nf_email_templates WHERE id = ?', id);
  if (result.changes === 0) return NextResponse.json({ error: '템플릿을 찾을 수 없습니다.' }, { status: 404 });

  return NextResponse.json({ ok: true });
}
