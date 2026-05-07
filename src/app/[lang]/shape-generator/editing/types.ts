export type EditMode = 'none' | 'vertex' | 'edge' | 'face';

export interface UniqueFace {
  id: number;
  triangleIndices: number[];
  normal: [number, number, number];
  center: [number, number, number];
}

export interface UniqueVertex {
  id: number;
  indices: number[];
  position: [number, number, number];
}

export interface UniqueEdge {
  id: number;
  vertexA: number;
  vertexB: number;
  midpoint: [number, number, number];
}
