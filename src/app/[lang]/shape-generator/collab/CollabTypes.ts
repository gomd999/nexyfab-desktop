// ─── Collaboration Types ─────────────────────────────────────────────────────

export interface CollabUser {
  id: string;
  name: string;
  color: string;
  cursor?: { x: number; y: number; z: number };   // 3D world position
  cursor2d?: { x: number; y: number };             // screen position
  activeFeature?: string;
  lastSeen: number;
}

export type CollabMessageType = 'cursor' | 'presence' | 'feature-lock' | 'chat';

/** Legacy WebSocket cursor payload (send uses x,y,z; receive may use nested `cursor`). */
export interface CollabWsCursorPayload {
  x?: number;
  y?: number;
  z?: number;
  name?: string;
  color?: string;
  cursor?: { x: number; y: number; z: number };
  cursor2d?: { x: number; y: number };
  activeFeature?: string;
}

export interface CollabWsPresencePayload {
  action?: string;
  [key: string]: unknown;
}

export type CollabMessage =
  | { type: 'cursor'; userId: string; payload: CollabWsCursorPayload }
  | { type: 'presence'; userId: string; payload: CollabWsPresencePayload }
  | { type: 'feature-lock'; userId: string; payload: unknown }
  | { type: 'chat'; userId: string; payload: unknown };

export interface CollabState {
  users: CollabUser[];
  isConnected: boolean;
  demoMode: boolean;
}
