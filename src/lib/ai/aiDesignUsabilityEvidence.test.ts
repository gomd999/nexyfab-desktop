import { describe, expect, it } from 'vitest';
import { createAiDesignUsabilityEvent, summarizeAiDesignUsability } from './aiDesignUsabilityEvidence';

const event = (id: string, type: Parameters<typeof createAiDesignUsabilityEvent>[0]['type'], elapsedMs: number, result: Parameters<typeof createAiDesignUsabilityEvent>[0]['result'] = 'PASS') => createAiDesignUsabilityEvent({
  eventId: id,
  scenarioId: 'text-to-synchronized-concept',
  type,
  elapsedMs,
  device: 'desktop',
  inputKind: type === 'WORKSPACE_OPENED' ? 'none' : 'text',
  viewMode: type === 'WORKSPACE_OPENED' ? 'chat' : 'split',
  result,
  reasonCode: null,
});

describe('AI Design usability evidence', () => {
  it('summarizes first action, completion, errors and assistance without content', () => {
    const summary = summarizeAiDesignUsability([
      event('event-1', 'WORKSPACE_OPENED', 0),
      event('event-2', 'FIRST_INPUT_SUBMITTED', 12_000),
      event('event-3', 'VIEW_MODE_CHANGED', 16_000),
      event('event-4', 'PREVIEW_CREATED', 30_000),
      event('event-5', 'SCENARIO_COMPLETED', 52_000),
    ]);
    expect(summary).toMatchObject({ timeToFirstInputMs: 12_000, timeToCompletionMs: 52_000, completed: true, helpOpenCount: 0, invalidActionCount: 0 });
    expect(summary.heuristic).toEqual({ firstActionWithoutInstruction: 'PASS', lowAssistance: 'PASS', lowError: 'PASS', note: 'heuristic_only_not_release_evidence' });
    expect(summary.privacy).toEqual({ userContentCollected: false, geometryCollected: false, personalDataCollected: false });
  });

  it('reports heuristics honestly when evidence is missing or assistance is high', () => {
    const summary = summarizeAiDesignUsability([
      event('event-1', 'WORKSPACE_OPENED', 0),
      event('event-2', 'HELP_OPENED', 2_000),
      event('event-3', 'HELP_OPENED', 4_000),
      event('event-4', 'INVALID_ACTION', 5_000, 'FAIL'),
      event('event-5', 'INVALID_ACTION', 6_000, 'FAIL'),
    ]);
    expect(summary).toMatchObject({ completed: false, timeToFirstInputMs: null, timeToCompletionMs: null });
    expect(summary.heuristic).toMatchObject({ firstActionWithoutInstruction: 'NOT_RUN', lowAssistance: 'FAIL', lowError: 'FAIL' });
  });

  it('rejects mixed scenario bindings and content-like free-form reason codes', () => {
    const first = event('event-1', 'WORKSPACE_OPENED', 0);
    const second = createAiDesignUsabilityEvent({ ...first, eventId: 'event-2', scenarioId: 'another-scenario' });
    expect(() => summarizeAiDesignUsability([first, second])).toThrow('usability_event_binding_mismatch');
    expect(() => createAiDesignUsabilityEvent({ ...first, eventId: 'event-3', reasonCode: 'contains private prompt text' })).toThrow('usability_event_reason_invalid');
    expect(() => summarizeAiDesignUsability([event('event-late', 'WORKSPACE_OPENED', 10), event('event-early', 'FIRST_INPUT_SUBMITTED', 5)])).toThrow('usability_event_order_invalid');
    expect(() => summarizeAiDesignUsability([first, first])).toThrow('usability_event_duplicate');
  });
});
