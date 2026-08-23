import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import type { CadJobMessage } from '../../../packages/job-contracts/src/index';
import { runCadJobWorkflow, type JobOrchestratorEnv } from './core';

export class CadJobWorkflow extends WorkflowEntrypoint<JobOrchestratorEnv, CadJobMessage> {
  override run(event: WorkflowEvent<CadJobMessage>, step: WorkflowStep): Promise<Record<string, unknown>> {
    return runCadJobWorkflow(event.payload, this.env, step);
  }
}
