/**
 * B3 — History compression tests.
 */
import { describe, it, expect } from 'vitest';
import { compressHistory, approxHistoryBytes, COMPRESSION_DEFAULTS } from '../historyCompression';
import type { AgentMessage } from '../types';

function bigUserMessage(label: string, kb: number): AgentMessage {
  return { role: 'user', content: `${label}: ${'x'.repeat(kb * 1024)}` };
}

function bigAssistant(label: string, kb: number): AgentMessage {
  return {
    role: 'assistant',
    content: `${label}: ${'x'.repeat(kb * 1024)}`,
    toolCalls: [{ id: 'c1', name: 'render', args: {} }],
  };
}

function toolResult(ok: boolean, id: string, body: string): AgentMessage {
  return {
    role: 'tool_result',
    toolCallId: id,
    result: ok
      ? { ok: true, output: body }
      : { ok: false, error: body, code: 'X' },
  };
}

describe('compressHistory', () => {
  it('no-op below threshold', () => {
    const history: AgentMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello', toolCalls: [] },
    ];
    const r = compressHistory(history);
    expect(r.compressed).toBe(false);
    expect(r.history).toBe(history);
  });

  it('compresses the middle when above threshold', () => {
    const history: AgentMessage[] = [{ role: 'system', content: 'sys' }];
    // 12 big messages × 100KB = 1.2MB > 800KB threshold
    for (let i = 0; i < 12; i++) {
      history.push(bigUserMessage(`turn${i}`, 100));
      history.push(bigAssistant(`reply${i}`, 100));
    }
    const before = approxHistoryBytes(history);
    expect(before).toBeGreaterThan(COMPRESSION_DEFAULTS.thresholdBytes);

    const r = compressHistory(history);
    expect(r.compressed).toBe(true);
    expect(r.savedBytes).toBeGreaterThan(0);

    // System head preserved.
    expect(r.history[0].role).toBe('system');
    // A summary message follows.
    expect(r.history[1].role).toBe('user');
    expect((r.history[1] as { content: string }).content).toContain('[history-summary]');
    // Last `keepRecent` (8) messages survived verbatim.
    expect(r.history.length).toBe(1 + 1 + COMPRESSION_DEFAULTS.keepRecent);
  });

  it('preserves system prompt content untouched', () => {
    const sysContent = 'YOU ARE A CAD AGENT (special)';
    const history: AgentMessage[] = [{ role: 'system', content: sysContent }];
    for (let i = 0; i < 20; i++) history.push(bigUserMessage(`x${i}`, 80));
    const r = compressHistory(history);
    expect(r.compressed).toBe(true);
    expect((r.history[0] as { content: string }).content).toBe(sysContent);
  });

  it('summary mentions both user and assistant turns', () => {
    const history: AgentMessage[] = [{ role: 'system', content: 'sys' }];
    for (let i = 0; i < 6; i++) {
      history.push(bigUserMessage(`task${i}`, 100));
      history.push(bigAssistant(`reply${i}`, 100));
      history.push(toolResult(true, `c${i}`, `OK ${i}`));
    }
    // Push more to clearly cross threshold.
    for (let i = 0; i < 6; i++) history.push(bigUserMessage(`pad${i}`, 80));
    const r = compressHistory(history);
    expect(r.compressed).toBe(true);
    const sumMsg = r.history[1] as { content: string };
    expect(sumMsg.content).toMatch(/USER:/);
    expect(sumMsg.content).toMatch(/AGENT:/);
    expect(sumMsg.content).toMatch(/tool_result/);
  });

  it('respects custom keepRecent + threshold', () => {
    const history: AgentMessage[] = [{ role: 'system', content: 'sys' }];
    for (let i = 0; i < 30; i++) history.push({ role: 'user', content: 'x'.repeat(50_000) });
    const r = compressHistory(history, { thresholdBytes: 100_000, keepRecent: 3 });
    expect(r.compressed).toBe(true);
    // 1 system + 1 summary + 3 tail = 5 entries.
    expect(r.history.length).toBe(5);
  });

  it('no-op when total messages fewer than keepRecent', () => {
    const history: AgentMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'x'.repeat(2_000_000) },  // huge but only 1 message
    ];
    const r = compressHistory(history, { thresholdBytes: 100_000, keepRecent: 8 });
    expect(r.compressed).toBe(false);
  });

  it('compressed history readable by approxHistoryBytes', () => {
    const history: AgentMessage[] = [{ role: 'system', content: 'sys' }];
    for (let i = 0; i < 20; i++) history.push(bigUserMessage(`x${i}`, 80));
    const r = compressHistory(history);
    const after = approxHistoryBytes(r.history);
    expect(after).toBeLessThan(COMPRESSION_DEFAULTS.thresholdBytes);
  });
});
