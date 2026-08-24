import {
  createAiDesignComplexWorkspaceAggregate,
  validateAiDesignComplexWorkspaceAggregate,
  type AiDesignComplexWorkspaceAggregateV1,
} from './aiDesignComplexWorkspaceAggregate';

export interface AiDesignComplexWorkspaceStore {
  loadOrCreate(input: { ownerKey: string; projectId: string; sessionId: string; runtimeRevision: number; now?: string }): Promise<AiDesignComplexWorkspaceAggregateV1>;
  save(ownerKey: string, aggregate: AiDesignComplexWorkspaceAggregateV1, expectedComplexRevision: number): Promise<AiDesignComplexWorkspaceAggregateV1>;
  reset(): void;
}

function clone<T>(value: T): T { return structuredClone(value); }
function key(ownerKey: string, projectId: string, sessionId: string): string { return `${ownerKey}\0${projectId}\0${sessionId}`; }

/** Reference-only store. Commercial mode requires integration-owned PostgreSQL CAS. */
export class InMemoryAiDesignComplexWorkspaceStore implements AiDesignComplexWorkspaceStore {
  private readonly values = new Map<string, AiDesignComplexWorkspaceAggregateV1>();

  constructor(private readonly mode: 'reference' | 'commercial' = 'reference') {}

  private ensure(): void {
    if (this.mode === 'commercial' || process.env.NEXYFAB_COMMERCIAL_MODE === '1') throw new Error('AI_DESIGN_COMPLEX_POSTGRES_AUTHORITATIVE_REQUIRED');
  }

  async loadOrCreate(input: { ownerKey: string; projectId: string; sessionId: string; runtimeRevision: number; now?: string }): Promise<AiDesignComplexWorkspaceAggregateV1> {
    this.ensure();
    const storageKey = key(input.ownerKey, input.projectId, input.sessionId);
    const existing = this.values.get(storageKey);
    if (existing) return clone(existing);
    const created = createAiDesignComplexWorkspaceAggregate(input);
    this.values.set(storageKey, created);
    return clone(created);
  }

  async save(ownerKey: string, aggregate: AiDesignComplexWorkspaceAggregateV1, expectedComplexRevision: number): Promise<AiDesignComplexWorkspaceAggregateV1> {
    this.ensure();
    const issues = validateAiDesignComplexWorkspaceAggregate(aggregate);
    if (issues.length) throw new Error(`AI_DESIGN_COMPLEX_AGGREGATE_INVALID:${issues.join(',')}`);
    if (aggregate.complexRevision !== expectedComplexRevision + 1) throw new Error('AI_DESIGN_COMPLEX_REVISION_TRANSITION_INVALID');
    const storageKey = key(ownerKey, aggregate.projectId, aggregate.sessionId);
    const current = this.values.get(storageKey);
    if (!current) throw new Error('AI_DESIGN_COMPLEX_WORKSPACE_NOT_FOUND');
    if (current.complexRevision !== expectedComplexRevision) throw new Error('AI_DESIGN_COMPLEX_REVISION_CONFLICT');
    this.values.set(storageKey, clone(aggregate));
    return clone(aggregate);
  }

  reset(): void { this.values.clear(); }
}

export const aiDesignComplexWorkspaceStore = new InMemoryAiDesignComplexWorkspaceStore();
