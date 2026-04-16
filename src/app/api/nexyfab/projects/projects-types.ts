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
}
