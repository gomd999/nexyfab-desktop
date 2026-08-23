export const ARCHITECTURE_INTERIOR_RECOVERY_SCHEMA: string;
export const ARCHITECTURE_INTERIOR_RECOVERY_SOURCE_SCHEMA: string;
export const ARCHITECTURE_INTERIOR_RECOVERY_MAX_AGE_MS: number;
export const ARCHITECTURE_INTERIOR_RECOVERY_MAX_SOURCE_BYTES: number;
export const ARCHITECTURE_INTERIOR_RECOVERY_MAX_OBSERVATION_BODY_BYTES: number;
export const ARCHITECTURE_INTERIOR_RECOVERY_CHECKS: readonly string[];

export function workspaceSnapshot(workspace: unknown, editedObjectId: string): unknown;
export function assertObjectIdentity(before: unknown, after: unknown): void;
export function buildArchitectureInteriorRecoveryEvidence(input: Record<string, unknown>): unknown;
export function verifyArchitectureInteriorRecoveryEvidence(
  receipt: unknown,
  expectedRelease: unknown,
  options?: { root?: string; now?: number },
): boolean;
export function writeArchitectureInteriorRecoveryEvidence(input: Record<string, unknown>): unknown;
export function clearArchitectureInteriorRecoveryEvidence(input: { root?: string; artifactPath: string }): void;
