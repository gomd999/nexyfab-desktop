// ─── Shared collab event types (used by both server route and client hook) ────

export type CollabEventType =
  | 'cursor_move'
  | 'param_change'
  | 'shape_change'
  | 'user_join'
  | 'user_leave'
  | 'comment_add'
  | 'comment_resolve'
  | 'comment_delete'
  | 'comment_react'
  | 'comment_reply'
  | 'chat_message'
  | 'typing_start'
  | 'typing_stop'
  | 'feature_sync';

export interface CollabEvent {
  type: CollabEventType;
  userId: string;
  payload: unknown;
  ts: number;
}
