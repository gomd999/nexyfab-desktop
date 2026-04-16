// ─── Shared collab event types (used by both server route and client hook) ────

export type CollabEventType =
  | 'cursor_move'
  | 'param_change'
  | 'shape_change'
  | 'user_join'
  | 'user_leave';

export interface CollabEvent {
  type: CollabEventType;
  userId: string;
  payload: unknown;
  ts: number;
}
