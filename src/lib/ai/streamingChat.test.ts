import { describe, it, expect } from 'vitest';
import {
  streamChat,
  openAiDeltaExtractor,
  anthropicDeltaExtractor,
  collectStream,
  type ChunkSource,
} from './streamingChat';

async function* arraySource(arr: string[]): ChunkSource {
  for (const s of arr) yield s;
}

describe('openAiDeltaExtractor', () => {
  it('extracts content from a delta frame', () => {
    const frame = 'data: {"choices":[{"delta":{"content":"hello"}}]}';
    expect(openAiDeltaExtractor(frame)).toBe('hello');
  });

  it('returns null on [DONE]', () => {
    expect(openAiDeltaExtractor('data: [DONE]')).toBeNull();
  });

  it('returns null on malformed JSON', () => {
    expect(openAiDeltaExtractor('data: {garbage')).toBeNull();
  });

  it('returns null when delta lacks content field', () => {
    expect(openAiDeltaExtractor('data: {"choices":[{"delta":{"role":"assistant"}}]}')).toBeNull();
  });
});

describe('anthropicDeltaExtractor', () => {
  it('extracts text from content_block_delta', () => {
    const frame = 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}';
    expect(anthropicDeltaExtractor(frame)).toBe('hi');
  });

  it('returns null on other event types', () => {
    expect(anthropicDeltaExtractor('data: {"type":"message_start"}')).toBeNull();
  });
});

describe('streamChat', () => {
  it('yields incremental deltas + final done frame', async () => {
    const lines = [
      'data: {"choices":[{"delta":{"content":"hel"}}]}\n',
      'data: {"choices":[{"delta":{"content":"lo "}}]}\n',
      'data: {"choices":[{"delta":{"content":"world"}}]}\n',
      'data: [DONE]\n',
    ];
    const chunks: string[] = [];
    let final = '';
    for await (const c of streamChat(arraySource(lines), { extractDelta: openAiDeltaExtractor })) {
      chunks.push(c.delta);
      if (c.done) final = c.accumulated;
    }
    expect(final).toBe('hello world');
  });

  it('survives a frame split across raw chunks', async () => {
    // The "lo" delta straddles a chunk boundary.
    const lines = [
      'data: {"choices":[{"delta":{"content":"he',
      'l',
      'lo"}}]}\ndata: [DONE]\n',
    ];
    const final = await collectStream(streamChat(arraySource(lines), { extractDelta: openAiDeltaExtractor }));
    expect(final).toBe('hello');
  });

  it('respects abort signal', async () => {
    const ac = new AbortController();
    const source = (async function* () {
      yield 'data: {"choices":[{"delta":{"content":"a"}}]}\n';
      ac.abort();
      yield 'data: {"choices":[{"delta":{"content":"b"}}]}\n';
      yield 'data: [DONE]\n';
    })();
    const final = await collectStream(streamChat(source, { extractDelta: openAiDeltaExtractor, signal: ac.signal }));
    expect(final).toBe('a');
  });

  it('skips non-text frames (heartbeats)', async () => {
    const lines = [
      ': heartbeat\n',
      'data: {"choices":[{"delta":{"content":"x"}}]}\n',
      'data: [DONE]\n',
    ];
    const final = await collectStream(streamChat(arraySource(lines), { extractDelta: openAiDeltaExtractor }));
    expect(final).toBe('x');
  });
});

describe('collectStream', () => {
  it('returns final accumulated value', async () => {
    const lines = [
      'data: {"choices":[{"delta":{"content":"abc"}}]}\n',
      'data: [DONE]\n',
    ];
    const r = await collectStream(streamChat(arraySource(lines), { extractDelta: openAiDeltaExtractor }));
    expect(r).toBe('abc');
  });
});
