import { createHash, createHmac } from 'node:crypto';

function stableJson(value: unknown): string | null {
  try {
    const json = JSON.stringify(value);
    return json === undefined ? null : json;
  } catch {
    return null;
  }
}

export function hashRemoteArguments(value: unknown): string {
  return createHash('sha256').update(stableJson(value) ?? 'invalid').digest('hex');
}

function approvalSecret(env: Record<string, string | undefined>): string {
  const value = (env.NEXYFAB_AGENT_APPROVAL_SECRET ?? env.NEXYFAB_SERVER_SECRET ?? '').trim();
  return value.length >= 32 ? value : '';
}

export function makeRemoteApprovalToken(
  input: { userId: string; projectId: string; revision: number; tool: string; arguments: unknown },
  env: Record<string, string | undefined> = process.env,
): string | null {
  const secret = approvalSecret(env);
  if (!secret) return null;
  const binding = `${input.userId}:${input.projectId}:${input.revision}:${input.tool}:${hashRemoteArguments(input.arguments)}`;
  return createHmac('sha256', secret).update(binding).digest('base64url');
}
