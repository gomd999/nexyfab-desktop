// ─── Types ────────────────────────────────────────────────────────────────────

export interface MeshComment {
  id: string;
  projectId: string;
  position: [number, number, number];
  text: string;
  author: string;
  authorPlan?: string;
  createdAt: number;
  resolved: boolean;
  type: 'comment' | 'issue' | 'approval';
}

// ─── Row → MeshComment ───────────────────────────────────────────────────────

export function rowToComment(row: Record<string, unknown>): MeshComment {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    position: JSON.parse(row.position as string) as [number, number, number],
    text: row.text as string,
    author: row.author as string,
    authorPlan: (row.author_plan as string) || undefined,
    createdAt: row.created_at as number,
    resolved: !!(row.resolved as number),
    type: (row.type as MeshComment['type']) ?? 'comment',
  };
}
