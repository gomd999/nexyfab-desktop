import type { DesignIntentCheckpointV1, DesignIntentConflict, DesignIntentMissingField } from './designIntentCheckpoint';
import type { AiDesignIntentGraphV1, AiDesignIntentNode } from './aiDesignIntentGraph';

export const AI_DESIGN_QUESTION_PLANNER_SCHEMA = 'nexyfab.ai-design-question-planner.v1' as const;
export const AI_DESIGN_MAX_QUESTIONS = 12;
export interface AiDesignQuestionChoice { id: string; label: string; value?: unknown; sourceIds: string[]; sourceHashes: string[]; }
export interface AiDesignQuestion { id: string; key: string; kind: 'missing' | 'conflict' | 'assumption' | 'low_confidence'; priority: number; reason: string; prompt: string; choices: AiDesignQuestionChoice[]; impact: number; }
export interface AiDesignQuestionPlanV1 { schema: typeof AI_DESIGN_QUESTION_PLANNER_SCHEMA; projectId: string; revision: number; questions: AiDesignQuestion[]; unresolvedCount: number; }
function hash(value: string): string { let result = 2166136261; for (let i = 0; i < value.length; i += 1) result = Math.imul(result ^ value.charCodeAt(i), 16777619); return (result >>> 0).toString(16).padStart(8, '0'); }
function serialized(value: unknown): string { try { return JSON.stringify(value); } catch { return '[unserializable]'; } }
function preview(value: unknown, max = 160): string { const text = typeof value === 'string' ? value : serialized(value); return text.slice(0, max); }
function questionId(kind: string, key: string): string { return `question:${kind}:${hash(`${kind}:${key}`)}`; }
function choiceId(value: unknown, index: number): string { return `choice:${hash(`${index}:${serialized(value)}`)}`; }
function missingQuestion(field: DesignIntentMissingField, node: AiDesignIntentNode | undefined): AiDesignQuestion { return { id: questionId('missing', field.key), key: field.key, kind: 'missing', priority: 100 + Math.round((node?.impact ?? 0.5) * 20), reason: field.reason, prompt: field.question, choices: [{ id: 'choice:provide-value', label: 'Provide a value', sourceIds: [], sourceHashes: [] }], impact: node?.impact ?? 0.5 }; }
function conflictQuestion(conflict: DesignIntentConflict, node: AiDesignIntentNode | undefined): AiDesignQuestion { const choices: AiDesignQuestionChoice[] = conflict.values.map((value, index) => ({ id: choiceId(value.value, index), label: preview(value.value), value: value.value, sourceIds: [...value.sourceIds].sort(), sourceHashes: [...value.sourceHashes].sort() })); choices.push({ id: 'choice:provide-value', label: 'Provide another value', value: undefined, sourceIds: [], sourceHashes: [] }); return { id: questionId('conflict', conflict.key), key: conflict.key, kind: 'conflict', priority: 120 + Math.round((node?.impact ?? 0.5) * 20), reason: 'conflicting values require an explicit decision', prompt: conflict.resolutionQuestion.slice(0, 1_000), choices, impact: node?.impact ?? 0.5 }; }

/** Rank unresolved items without ever choosing a conflict or confirming an assumption. */
export function planAiDesignQuestions(checkpoint: DesignIntentCheckpointV1, graph?: AiDesignIntentGraphV1, limit = AI_DESIGN_MAX_QUESTIONS): AiDesignQuestionPlanV1 {
  const nodeFor = (key: string, kind?: string) => graph?.nodes.find(node => node.key === key && (!kind || node.kind === kind));
  const questions: AiDesignQuestion[] = [];
  for (const field of checkpoint.missingFields) if (field.reason === 'unresolved_conflict') { const conflict = checkpoint.conflicts.find(item => item.key === field.key); if (conflict) questions.push(conflictQuestion(conflict, nodeFor(field.key, 'conflict'))); else questions.push(missingQuestion(field, nodeFor(field.key, 'missing'))); } else questions.push(missingQuestion(field, nodeFor(field.key, 'missing')));
  for (const node of graph?.nodes ?? []) if ((node.kind === 'assumption' || node.kind === 'fact' && node.confidence < 0.6) && node.status === 'active' && !questions.some(question => question.key === node.key)) questions.push({ id: questionId(node.kind === 'assumption' ? 'assumption' : 'low_confidence', node.key), key: node.key, kind: node.kind === 'assumption' ? 'assumption' : 'low_confidence', priority: 70 + Math.round(node.impact * 20) + (node.kind === 'assumption' ? 10 : 0), reason: node.kind === 'assumption' ? 'AI-derived value needs confirmation' : 'source confidence is low', prompt: `Confirm the value for ${node.key.slice(0, 160)}: ${preview(node.value)}`, choices: [{ id: 'choice:confirm', label: 'Confirm this value', value: node.value, sourceIds: [...node.provenance.sourceIds], sourceHashes: [...node.provenance.sourceHashes] }, { id: 'choice:provide-value', label: 'Provide another value', sourceIds: [], sourceHashes: [] }], impact: node.impact });
  questions.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  const bounded = Math.max(0, Math.min(AI_DESIGN_MAX_QUESTIONS, Math.floor(limit)));
  return { schema: AI_DESIGN_QUESTION_PLANNER_SCHEMA, projectId: checkpoint.projectId, revision: checkpoint.revision, questions: questions.slice(0, bounded), unresolvedCount: questions.length };
}
