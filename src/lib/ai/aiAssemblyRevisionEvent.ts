import type { AiAssemblyRevisionPackage } from './aiAssemblyRevision';

export const AI_ASSEMBLY_REVISION_REQUEST_EVENT = 'nexyfab:ai-assembly-revision-request';
export const AI_ASSEMBLY_REVISION_RESULT_EVENT = 'nexyfab:ai-assembly-revision-result';
export type AiAssemblyRevisionRequest = { requestId: string; lineageId: string; revision: number; baseProgramHash: string };
export type AiAssemblyRevisionResult = { requestId: string; ok: true; programBytes: Uint8Array; manifestBytes: Uint8Array; manifest: AiAssemblyRevisionPackage } | { requestId: string; ok: false; error: string };
