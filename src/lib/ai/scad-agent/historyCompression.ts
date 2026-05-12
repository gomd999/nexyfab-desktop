/**
 * B3 — Conversation history compression.
 *
 * `truncateHistoryIfNeeded` (in runScadAgent.ts) is the floor — when a
 * session exceeds the byte/message cap it drops oldest messages outright.
 * That works but loses context: the agent forgets what it tried 6 turns
 * ago and may repeat the same mistake.
 *
 * This compressor is the smarter ceiling: when history grows past
 * `compressionThresholdBytes` (default 800KB), pack the older half into
 * a single synthetic system note that summarizes "what happened
 * structurally" without the raw tool traffic. The agent keeps high-level
 * memory while the recent N turns stay verbatim for fine-grained control.
 *
 * No LLM call required — this is a deterministic structural summary.
 * Avoiding an extra LLM round keeps the compressor cheap (a compression
 * that costs $0.01 to save $0.005 in tokens is a loss).
 */
import type { AgentMessage } from './types';

export const COMPRESSION_DEFAULTS = {
  /** Trigger compression when history exceeds this many bytes. */
  thresholdBytes: 800_000,
  /** Always keep at least this many recent messages verbatim. */
  keepRecent: 8,
} as const;

export interface CompressionResult {
  history: AgentMessage[];
  /** Was anything compressed this round? */
  compressed: boolean;
  /** Bytes saved (approximate). */
  savedBytes: number;
}

function approxBytes(messages: AgentMessage[]): number {
  let n = 0;
  for (const m of messages) {
    if (m.role === 'tool_result') {
      n += 100 + (m.result.ok ? m.result.output.length : m.result.error.length);
    } else {
      n += 100 + m.content.length;
      if (m.role === 'assistant' && m.toolCalls) {
        for (const tc of m.toolCalls) n += JSON.stringify(tc).length;
      }
    }
  }
  return n;
}

/**
 * Render the older half of history into a one-line-per-event summary
 * that the agent can scan in <100 tokens regardless of how chatty the
 * original turns were.
 */
function summarizeMessages(messages: AgentMessage[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue; // never summarize the system prompt
    if (m.role === 'user') {
      lines.push(`USER: ${truncate(m.content, 120)}`);
    } else if (m.role === 'assistant') {
      const toolNames = (m.toolCalls ?? []).map(t => t.name).join(', ');
      const narration = m.content.trim().split('\n')[0];
      const head = narration ? truncate(narration, 100) : '(tool call only)';
      lines.push(`AGENT: ${head}${toolNames ? `  → tools: ${toolNames}` : ''}`);
    } else if (m.role === 'tool_result') {
      const tag = m.result.ok ? 'ok' : `ERR:${m.result.code ?? '?'}`;
      const body = m.result.ok
        ? truncate(m.result.output.split('\n')[0], 80)
        : truncate(m.result.error, 80);
      lines.push(`  → tool_result[${tag}]: ${body}`);
    }
  }
  return lines.join('\n');
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

/**
 * Apply compression in place and return the new history. Idempotent: if
 * the history is below threshold, returns the input unchanged.
 *
 * Strategy:
 *   1. Always keep system prompt at index 0.
 *   2. Keep the last `keepRecent` messages verbatim.
 *   3. Everything in between gets folded into a single user message
 *      tagged `[history-summary]` so the agent knows it's a digest.
 */
export function compressHistory(
  history: AgentMessage[],
  opts: { thresholdBytes?: number; keepRecent?: number } = {},
): CompressionResult {
  const threshold = opts.thresholdBytes ?? COMPRESSION_DEFAULTS.thresholdBytes;
  const keepRecent = opts.keepRecent ?? COMPRESSION_DEFAULTS.keepRecent;

  const totalBytes = approxBytes(history);
  if (totalBytes < threshold) {
    return { history, compressed: false, savedBytes: 0 };
  }

  // Identify the system head (if any) and the recent tail to preserve.
  const systemHead = history[0]?.role === 'system' ? [history[0]] : [];
  const middleStart = systemHead.length;
  const middleEnd = Math.max(middleStart, history.length - keepRecent);
  if (middleEnd <= middleStart) {
    // Nothing to compress (history shorter than keepRecent).
    return { history, compressed: false, savedBytes: 0 };
  }

  const middle = history.slice(middleStart, middleEnd);
  const tail = history.slice(middleEnd);

  const summary = summarizeMessages(middle);
  const summaryMessage: AgentMessage = {
    role: 'user',
    content:
      `[history-summary] The following is a structural digest of ${middle.length} earlier messages. Use it for context but do not re-derive the same conclusions.\n\n${summary}`,
  };

  const next: AgentMessage[] = [...systemHead, summaryMessage, ...tail];
  const savedBytes = totalBytes - approxBytes(next);

  return { history: next, compressed: true, savedBytes };
}

// Pure helper used by tools-side state transitions if needed.
export { approxBytes as approxHistoryBytes };
