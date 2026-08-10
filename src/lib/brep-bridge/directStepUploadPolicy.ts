import { BREP_STEP_BROWSER_MAX_BYTES, BREP_STEP_LARGE_JOB_MAX_BYTES } from './constants';
import { isAllowedStepFilename } from './validation';

export type DirectStepUploadDecision =
  | { ok: true; filename: string; sizeBytes: number }
  | { ok: false; code: 'INVALID_FILENAME' | 'INVALID_SIZE' | 'BROWSER_PATH_SUFFICIENT' | 'TOO_LARGE' };

export function validateDirectStepUpload(filename: string, sizeBytes: number): DirectStepUploadDecision {
  const normalized = filename.trim();
  if (!isAllowedStepFilename(normalized)) return { ok: false, code: 'INVALID_FILENAME' };
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) return { ok: false, code: 'INVALID_SIZE' };
  if (sizeBytes <= BREP_STEP_BROWSER_MAX_BYTES) return { ok: false, code: 'BROWSER_PATH_SUFFICIENT' };
  if (sizeBytes > BREP_STEP_LARGE_JOB_MAX_BYTES) return { ok: false, code: 'TOO_LARGE' };
  return { ok: true, filename: normalized, sizeBytes };
}

export function isOwnedDirectStepKey(key: string, userId: string): boolean {
  return key.startsWith(`private/files/${userId}/`) && !key.includes('..') && !key.includes('\\');
}
