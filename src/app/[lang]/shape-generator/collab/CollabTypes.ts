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

export interface CollabMessage {
  type: CollabMessageType;
  userId: string;
  payload: any;
}

export interface CollabState {
  users: CollabUser[];
  isConnected: boolean;
  demoMode: boolean;
}
