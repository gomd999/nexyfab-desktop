/**
 * streamingChat.ts — Async-iterator wrapper around provider chat
 * streams (OpenAI, Anthropic, DeepSeek SSE).
 *
 * Stage-3 gives users a "live preview" as the model writes SCAD —
 * a 4kb response that took 3-5s as a single blob now feels
 * sub-second when the first 100 chars arrive in 200ms and the SCAD
 * preview renders progressively.
 *
 * Provider-agnostic design: each provider implements a minimal
 * `ChunkSource` (an async iterable of raw payloads) plus a parser
 * that knows how to extract textual deltas from that provider's
 * frame format. The wrapper unifies them into a `TextChunk` stream
 * the consumer pumps into the viewport.
 */

export interface TextChunk {
  /** Incremental text since the last chunk. Already decoded UTF-8. */
  delta: string;
  /** Cumulative text up to this point — caller convenience. */
  accumulated: string;
  /** Whether the stream has signalled end-of-message. */
  done: boolean;
}

export type ChunkSource = AsyncIterable<string | Uint8Array>;

export interface StreamingChatOptions {
  /** Per-provider extractor: raw chunk → text delta (or null if heartbeat). */
  extractDelta: (raw: string) => string | null;
  /** Optional cancel signal. */
  signal?: AbortSignal;
  /** Buffer flush size — yield when buffer ≥ this many bytes. */
  flushBytes?: number;
}

const decoder = new TextDecoder();

/**
 * Yields TextChunks as the provider streams. Buffers partial frames
 * across raw events because SSE frames can split mid-byte over network
 * boundaries (especially over slow links).
 */
export async function* streamChat(
  source: ChunkSource,
  opts: StreamingChatOptions,
): AsyncGenerator<TextChunk, void, void> {
  let buffer = '';
  let accumulated = '';
  const flushBytes = opts.flushBytes ?? 0;
  const sig = opts.signal;
  let aborted = false;
  if (sig) {
    sig.addEventListener('abort', () => { aborted = true; }, { once: true });
  }

  for await (const raw of source) {
    if (aborted) break;
    const txt = typeof raw === 'string' ? raw : decoder.decode(raw, { stream: true });
    buffer += txt;

    // Split on newline (SSE frame separator) and parse each one.
    const frames = buffer.split('\n');
    buffer = frames.pop() ?? ''; // keep the partial tail for the next iteration
    let pending = '';
    for (const frame of frames) {
      if (!frame.trim()) continue;
      const delta = opts.extractDelta(frame);
      if (delta === null) continue; // heartbeat / non-text frame
      pending += delta;
      accumulated += delta;
    }
    if (pending && pending.length >= flushBytes) {
      yield { delta: pending, accumulated, done: false };
    }
  }

  // Flush any remaining partial frame.
  if (buffer.trim()) {
    const delta = opts.extractDelta(buffer);
    if (delta !== null) {
      accumulated += delta;
      yield { delta, accumulated, done: false };
    }
  }
  yield { delta: '', accumulated, done: true };
}

/** OpenAI SSE delta extractor. */
export function openAiDeltaExtractor(line: string): string | null {
  const trimmed = line.startsWith('data:') ? line.slice(5).trim() : line.trim();
  if (!trimmed || trimmed === '[DONE]') return null;
  try {
    const json = JSON.parse(trimmed);
    return json.choices?.[0]?.delta?.content ?? null;
  } catch {
    return null;
  }
}

/** Anthropic Messages SSE delta extractor. */
export function anthropicDeltaExtractor(line: string): string | null {
  const trimmed = line.startsWith('data:') ? line.slice(5).trim() : line.trim();
  if (!trimmed) return null;
  try {
    const json = JSON.parse(trimmed);
    if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') {
      return json.delta.text ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

/** DeepSeek follows OpenAI shape. */
export const deepseekDeltaExtractor = openAiDeltaExtractor;

/** Helper: collect a stream into one final string. */
export async function collectStream(stream: AsyncIterable<TextChunk>): Promise<string> {
  let acc = '';
  for await (const chunk of stream) {
    if (chunk.done) acc = chunk.accumulated;
  }
  return acc;
}
