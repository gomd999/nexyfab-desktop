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
  | 'feature_sync'
  // ─── CRDT (Yjs) transport ──────────────────────────────────────────────────
  // `crdt_update`: a binary Y.Doc update from one client; relayed to all peers.
  // `crdt_sync_request`: a freshly-joined client asking for a state snapshot.
  // `crdt_sync_response`: a peer's reply with their full encoded state.
  // `crdt_awareness`: ephemeral presence (cursor / selection / identity).
  // Payloads are { update: base64 } so they survive JSON transport.
  | 'crdt_update'
  | 'crdt_sync_request'
  | 'crdt_sync_response'
  | 'crdt_awareness';

export interface CollabEvent {
  type: CollabEventType;
  userId: string;
  payload: unknown;
  ts: number;
}
