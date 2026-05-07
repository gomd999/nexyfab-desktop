// ─── Types ────────────────────────────────────────────────────────────────────

export interface NexyfabProject {
  id: string;
  userId: string;
  name: string;
  thumbnail?: string;
  shapeId?: string;
  materialId?: string;
  sceneData?: string;
  tags?: string[];
  updatedAt: number;
  createdAt: number;
  archivedAt?: number;
  /** ACL v0: sole-owner rows only; team shares may introduce editor/viewer later. */
  role?: 'owner' | 'editor' | 'viewer';
  /** False when server treats this session as read-only (future team ACL). */
  canEdit?: boolean;
}
