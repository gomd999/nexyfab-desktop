import { describe, expect, it } from 'vitest';
import { createAiDesignRuntimeTelemetryEvent, validateAiDesignRuntimeTelemetryEvent } from './aiDesignRuntimeTelemetry';

describe('AI Design runtime telemetry', () => {
  it('pseudonymizes identity and carries only allowlisted operational metadata', () => {
    const event = createAiDesignRuntimeTelemetryEvent({
      eventId: 'event-1', type: 'model_fallback', projectId: 'project-1', sessionId: 'session-1', runtimeRevision: 4,
      status: 'PASS', durationMs: 120, codes: ['provider_unavailable'], counts: { attempts: 2 },
      attributes: { fromModelId: 'gpt-luna', toModelId: 'qwen-3.7-plus', fallbackReason: 'provider_unavailable' },
      occurredAt: '2026-08-24T00:00:00Z',
    });
    expect(event.projectKey).not.toContain('project-1');
    expect(event).toMatchObject({ containsUserContent: false, containsGeometry: false, exactGeometryAuthority: false });
    expect(validateAiDesignRuntimeTelemetryEvent(event)).toEqual([]);
  });

  it('rejects prompts, geometry, secrets, invalid durations, and unbounded counters', () => {
    const base = { eventId: 'event-1', type: 'runtime_error' as const, projectId: 'project-1', sessionId: 'session-1', runtimeRevision: 1, status: 'FAIL' as const };
    expect(() => createAiDesignRuntimeTelemetryEvent({ ...base, attributes: { prompt: 'private design' } })).toThrow('telemetry_attribute_forbidden');
    expect(() => createAiDesignRuntimeTelemetryEvent({ ...base, attributes: { geometry: 'shape' } })).toThrow('telemetry_attribute_forbidden');
    expect(() => createAiDesignRuntimeTelemetryEvent({ ...base, durationMs: -1 })).toThrow('telemetry_duration_invalid');
    expect(() => createAiDesignRuntimeTelemetryEvent({ ...base, counts: { attempts: 1_000_001 } })).toThrow('telemetry_counts_invalid');
  });
});
