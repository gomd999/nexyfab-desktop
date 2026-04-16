// ─── Branch Types ─────────────────────────────────────────────────────────────

export interface DesignBranch {
  id: string;
  name: string;           // "main", "option-A", "lightweight-variant"
  parentBranch?: string;  // forked from which branch
  forkVersionId?: string; // forked at which version
  color: string;          // for visual distinction
  createdAt: number;
}

export interface BranchState {
  branches: DesignBranch[];
  activeBranch: string;   // current branch id
  /** branchId -> version ids belonging to that branch */
  branchVersions: Record<string, string[]>;
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const BRANCH_COLORS = [
  '#58a6ff', // blue  (main)
  '#3fb950', // green
  '#d29922', // orange
  '#bc8cff', // purple
  '#f85149', // red
  '#79c0ff', // light blue
  '#e3b341', // yellow
  '#db61a2', // pink
];

export const DEFAULT_BRANCH_ID = 'main';

export function createDefaultBranch(): DesignBranch {
  return {
    id: DEFAULT_BRANCH_ID,
    name: 'main',
    color: BRANCH_COLORS[0],
    createdAt: Date.now(),
  };
}

// ─── Diff result for branch comparison ──────────────────────────────────────

export interface BranchDiff {
  branchA: string;
  branchB: string;
  paramDiffs: Array<{ key: string; valueA: number | undefined; valueB: number | undefined }>;
  featureDiffsA: Array<{ type: string; params: Record<string, number>; enabled: boolean }>;
  featureDiffsB: Array<{ type: string; params: Record<string, number>; enabled: boolean }>;
  shapeA: string;
  shapeB: string;
  thumbnailA?: string;
  thumbnailB?: string;
}
