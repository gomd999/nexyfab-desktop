import * as THREE from 'three';

/**
 * Topological Naming Problem Tracking System
 * 
 * In parametric CAD, when an upstream sketch or feature is modified, the underlying
 * mesh topology (faces, edges, vertices) changes. Downstream operations like Fillet
 * or Chamfer that reference specific edge indices will fail or apply to the wrong edges.
 * 
 * This module provides a robust hashing system to generate persistent Topological IDs
 * for faces and edges. It traces their origin from the generator profile (e.g., Sketch Lines)
 * through operations (Extrude, Revolve, Boolean).
 */

export interface TopoHash {
  /** The unique hash string for the topology element */
  id: string;
  /** The semantic history of how this element was created */
  history: string[];
}

export interface TopoFace {
  /** BufferGeometry index mapping or Face identifier */
  faceIndex: number;
  hash: TopoHash;
  /** Normal vector to help disambiguate similar topological features */
  normal: THREE.Vector3;
}

export interface TopoEdge {
  /** Vertices forming the edge */
  v1: THREE.Vector3;
  v2: THREE.Vector3;
  hash: TopoHash;
  /** Adjacent face hashes */
  adjacentFaces: string[];
}

export class TopologyRegistry {
  private edgeMap = new Map<string, TopoEdge>();
  private faceMap = new Map<string, TopoFace>();

  /**
   * Generates a stable hash for a 2D sketch segment.
   * Format: [SketchID]_[SegmentType]_[LocalIndex]
   */
  static hashSketchSegment(sketchId: string, segmentType: string, index: number): string {
    return `${sketchId}_${segmentType}_${index}`;
  }

  /**
   * Derives a face hash from an extrusion operation.
   * If the face comes from sweeping a sketch segment, it combines the segment hash with the extrude ID.
   * Endcaps (top/bottom) get their own semantic tags.
   */
  static hashExtrudedFace(extrudeId: string, sourceHash: string, capType?: 'top' | 'bottom'): string {
    if (capType) {
      return `${extrudeId}_cap_${capType}`;
    }
    return `${extrudeId}_sweep_${sourceHash}`;
  }

  /**
   * Derives an edge hash from the intersection of two faces.
   */
  static hashEdgeFromFaces(face1Hash: string, face2Hash: string): string {
    // Sort to ensure stable hash regardless of face order
    const sorted = [face1Hash, face2Hash].sort();
    return `edge_${sorted[0]}|${sorted[1]}`;
  }

  /**
   * Register a new face in the topology tracker.
   */
  registerFace(faceIndex: number, hash: string, history: string[], normal: THREE.Vector3) {
    this.faceMap.set(hash, {
      faceIndex,
      hash: { id: hash, history },
      normal: normal.clone()
    });
  }

  /**
   * Register a new edge in the topology tracker.
   */
  registerEdge(v1: THREE.Vector3, v2: THREE.Vector3, hash: string, history: string[], adjacentFaces: string[]) {
    this.edgeMap.set(hash, {
      v1: v1.clone(),
      v2: v2.clone(),
      hash: { id: hash, history },
      adjacentFaces
    });
  }

  /**
   * Resolves a persistent Edge ID back to a geometric edge matching the current topology.
   */
  findEdgeByHash(hash: string): TopoEdge | undefined {
    return this.edgeMap.get(hash);
  }

  /**
   * Computes a similarity score between two topological hashes based on semantic history.
   * Useful for finding the "next best match" if the exact topology changed (e.g. added a hole).
   * 1.0 = exact match, 0.0 = no match.
   */
  static semanticSimilarity(hashA: string, hashB: string): number {
    if (hashA === hashB) return 1.0;
    
    // Split into semantic tokens (e.g., "edge", "extrude_1", "sweep", "sketch_2_line_0")
    const tokensA = hashA.split(/[_|]/);
    const tokensB = hashB.split(/[_|]/);
    
    let matches = 0;
    for (const t of tokensA) {
      if (tokensB.includes(t)) matches++;
    }
    
    const maxLen = Math.max(tokensA.length, tokensB.length);
    if (maxLen === 0) return 0;
    return matches / maxLen;
  }

  /**
   * Robust recovery algorithm:
   * When the exact edge hash isn't found (due to topology drift from a changed parameter),
   * this finds the matching edge using a combination of Semantic History (B-Rep DAG) 
   * and geometric fallback, ensuring parametric operations like Fillet survive sketch edits.
   */
  recoverEdge(targetHash: string, targetV1: THREE.Vector3, targetV2: THREE.Vector3): TopoEdge | undefined {
    let bestMatch: TopoEdge | undefined;
    let highestScore = -1;

    for (const edge of this.edgeMap.values()) {
      // 1. Evaluate Semantic Topological Match (Primary metric)
      const semanticScore = TopologyRegistry.semanticSimilarity(targetHash, edge.hash.id);
      
      // 2. Evaluate Geometric Proximity (Secondary metric for ties)
      const c1 = new THREE.Vector3().addVectors(targetV1, targetV2).multiplyScalar(0.5);
      const c2 = new THREE.Vector3().addVectors(edge.v1, edge.v2).multiplyScalar(0.5);
      const dist = c1.distanceTo(c2);
      
      // We map distance to a small penalty so semantic match takes precedence
      // but proximity breaks ties.
      const distancePenalty = Math.min(dist / 1000, 0.1); 
      
      const totalScore = semanticScore - distancePenalty;

      if (totalScore > highestScore && totalScore > 0.5) { // Minimum 50% semantic similarity required
        highestScore = totalScore;
        bestMatch = edge;
      }
    }

    // Fallback to strict distance if semantic names are completely wiped (legacy support)
    if (!bestMatch) {
      let minDistance = Infinity;
      for (const edge of this.edgeMap.values()) {
        const c1 = new THREE.Vector3().addVectors(targetV1, targetV2).multiplyScalar(0.5);
        const c2 = new THREE.Vector3().addVectors(edge.v1, edge.v2).multiplyScalar(0.5);
        const dist = c1.distanceTo(c2);
        if (dist < minDistance && dist < 1.0) { // 1mm threshold
          minDistance = dist;
          bestMatch = edge;
        }
      }
    }

    return bestMatch;
  }

  clear() {
    this.edgeMap.clear();
    this.faceMap.clear();
  }
}

/** Global singleton for the current pipeline run */
export const globalTopologyRegistry = new TopologyRegistry();
