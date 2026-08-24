import { describe, expect, it } from 'vitest';
import { createDesignIntentCheckpoint } from './designIntentCheckpoint';
import { createAiDesignIntentGraph } from './aiDesignIntentGraph';
import { planAiDesignQuestions } from './aiDesignQuestionPlanner';
const hash = 'b'.repeat(64);
const source = (id: string, key: string, value: unknown, authority: 'user_confirmed' | 'imported_authority' = 'user_confirmed') => ({ id, kind: 'text' as const, projectId: 'p-1', revision: 1, sourceHash: hash, authority, provenance: { rights: 'user_owned' as const, aiUseAllowed: true, derivativeUseAllowed: true }, fields: [{ key, value }] });
describe('AI design question planner', () => {
  it('ranks conflicts and exposes all explicit choices plus a new value option', () => { const checkpoint = createDesignIntentCheckpoint({ checkpointId: 'c', projectId: 'p-1', revision: 1, projectContentHash: hash, sources: [source('a', 'material', 'steel'), source('b', 'material', 'aluminium')] }); const plan = planAiDesignQuestions(checkpoint, createAiDesignIntentGraph(checkpoint)); expect(plan.questions[0]?.kind).toBe('conflict'); expect(plan.questions[0]?.choices).toHaveLength(3); });
  it('asks for assumption confirmation and never marks it confirmed', () => { const assumption = { ...source('a', 'mount', 'face-2'), authority: 'ai_assumption' as const }; const checkpoint = createDesignIntentCheckpoint({ checkpointId: 'c', projectId: 'p-1', revision: 1, projectContentHash: hash, sources: [assumption] }); const plan = planAiDesignQuestions(checkpoint, createAiDesignIntentGraph(checkpoint)); expect(plan.questions.some(question => question.kind === 'assumption')).toBe(true); expect(plan.questions.every(question => !question.id.includes('confirmed'))).toBe(true); });
  it('is deterministic and bounded', () => { const checkpoint = createDesignIntentCheckpoint({ checkpointId: 'c', projectId: 'p-1', revision: 1, projectContentHash: hash, sources: [source('a', 'purpose', 'bracket')] }); const graph = createAiDesignIntentGraph(checkpoint); expect(planAiDesignQuestions(checkpoint, graph, 1)).toEqual(planAiDesignQuestions(checkpoint, graph, 1)); });
});
