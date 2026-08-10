import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AgentSession } from './types';

const SIGNATURE_VERSION = 1 as const;
const MAX_CANONICAL_DEPTH = 32;

function secret(): string {
  const value = process.env.SCAD_AGENT_SESSION_SECRET ?? process.env.JWT_SECRET;
  if (!value) throw new Error('SCAD_AGENT_SESSION_SECRET or JWT_SECRET is required');
  return value;
}

function canonical(value: unknown, depth = 0): string {
  if (depth > MAX_CANONICAL_DEPTH) throw new Error('agent session nesting is too deep');
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  if (Array.isArray(value)) return `[${value.map(item => canonical(item, depth + 1)).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).filter(key => record[key] !== undefined).sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonical(record[key], depth + 1)}`).join(',')}}`;
  }
  return 'null';
}

function unsignedSession(session: AgentSession): Omit<AgentSession, 'integrity'> {
  const { integrity: _integrity, ...unsigned } = session;
  return unsigned;
}

function digest(session: AgentSession, userId: string, issuedAt: number): string {
  const payload = `${SIGNATURE_VERSION}\n${issuedAt}\n${userId}\n${canonical(unsignedSession(session))}`;
  return createHmac('sha256', secret()).update(payload).digest('hex');
}

export function signAgentSession(session: AgentSession, userId: string): AgentSession {
  const issuedAt = Date.now();
  session.integrity = {
    version: SIGNATURE_VERSION,
    issuedAt,
    signature: digest(session, userId, issuedAt),
  };
  return session;
}

export function verifyAgentSession(session: AgentSession, userId: string): boolean {
  const envelope = session.integrity;
  if (
    !envelope
    || envelope.version !== SIGNATURE_VERSION
    || !Number.isSafeInteger(envelope.issuedAt)
    || !/^[a-f0-9]{64}$/.test(envelope.signature)
  ) return false;
  const expected = Buffer.from(digest(session, userId, envelope.issuedAt), 'hex');
  const supplied = Buffer.from(envelope.signature, 'hex');
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
