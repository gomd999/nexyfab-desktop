import {
  handleCadJobQueue,
  handleJobOrchestratorFetch,
  type CadJobQueuePayload,
  type JobOrchestratorEnv,
  type QueueBatchLike,
} from './core';

export { CadJobLedger } from './ledger';
export { CadJobWorkflow } from './workflow';
export {
  ExactComputeContainer,
  OpenScadComputeContainer,
  FeaComputeContainer,
  InteropComputeContainer,
} from './containers';

const jobOrchestratorWorker = {
  fetch(request: Request, env: JobOrchestratorEnv): Promise<Response> {
    return handleJobOrchestratorFetch(request, env);
  },
  queue(batch: QueueBatchLike<CadJobQueuePayload>, env: JobOrchestratorEnv): Promise<void> {
    return handleCadJobQueue(batch, env);
  },
};

export default jobOrchestratorWorker;
