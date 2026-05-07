import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDbAdapter } from '@/lib/db-adapter';
import { checkOrigin } from '@/lib/csrf';
import { getAuthUser } from '@/lib/auth-middleware';
import { type MeshComment, rowToComment } from './comments-types';

// ─── GET /api/nexyfab/comments?projectId=xxx ─────────────────────────────────

export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const projectId = req.nextUrl.searchParams.get('projectId');
  if (!projectId) {
    return NextResponse.json({ error: 'projectId required' }, { status: 400 });
  }

  // 프로젝트 소유권 확인
  const db = getDbAdapter();
  const project = await db.queryOne<{ user_id: string }>(
    'SELECT user_id FROM nf_projects WHERE id = ?', projectId,
  );
  if (!project || project.user_id !== authUser.userId) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  const rows = await db.queryAll<Record<string, unknown>>(
    'SELECT * FROM nf_comments WHERE project_id = ? ORDER BY created_at ASC',
    projectId,
  );

  const comments = rows.map(rowToComment);
  return NextResponse.json({ comments, total: comments.length });
}

const commentSchema = z.object({
  projectId: z.string().min(1).max(128),
  position: z.tuple([z.number(), z.number(), z.number()]),
  text: z.string().min(1).max(2000),
  type: z.enum(['comment', 'issue', 'approval']).optional(),
  author: z.string().max(200).optional(),
  authorPlan: z.string().max(50).optional(),
});

// ─── POST /api/nexyfab/comments ──────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const raw = await req.json().catch(() => ({}));
  const parsed = commentSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? '입력값이 올바르지 않습니다.' },
      { status: 400 },
    );
  }
  const { projectId, position, text, type = 'comment' } = parsed.data;
  // author는 인증된 사용자 이메일 사용 (클라이언트 제공값 무시)
  const author = authUser.email;
  const authorPlan = authUser.plan;

  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const now = Date.now();

  try {
    const db = getDbAdapter();

    // 프로젝트 소유권 확인
    const project = await db.queryOne<{ user_id: string }>(
      'SELECT user_id FROM nf_projects WHERE id = ?', projectId,
    );
    if (!project || project.user_id !== authUser.userId) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    await db.execute(
      `INSERT INTO nf_comments
         (id, project_id, position, text, author, author_plan, type, resolved, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      id, projectId, JSON.stringify(position), text, author ?? 'Anonymous', authorPlan ?? null, type, now,
    );

    const row = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM nf_comments WHERE id = ?',
      id,
    );
    if (!row) {
      return NextResponse.json({ error: '댓글 저장 후 조회에 실패했습니다.' }, { status: 500 });
    }
    return NextResponse.json({ comment: rowToComment(row) }, { status: 201 });
  } catch (err) {
    console.error('[comments POST] DB error:', err);
    return NextResponse.json({ error: '댓글 저장에 실패했습니다.' }, { status: 500 });
  }
}
