import {
  invokeAgentToolCall,
  invokeAgentToolCatalog,
  invokeAiAgentTurn,
  type AgentToolCallInput,
  type AgentToolCallOutput,
  type AgentToolCatalog,
  type AiAgentTurnInput,
  type AiAgentTurnOutput,
  type TauriInvoke,
} from './tauriBridge';
import { createRemotePrecisionCadExecutor } from './remoteBridge';
import type { RemotePrecisionCadProjectBinding } from './remoteCadContract';

export type PrecisionCadExecutionContext = {
  binding?: RemotePrecisionCadProjectBinding;
  projectRoot?: string;
  locale: string;
  runId?: string;
  continuationId?: string;
};

export type PrecisionCadAgentExecutor = {
  catalog: (context: PrecisionCadExecutionContext) => Promise<AgentToolCatalog>;
  turn: (input: AiAgentTurnInput, context: PrecisionCadExecutionContext) => Promise<AiAgentTurnOutput>;
  tool: (input: AgentToolCallInput, context: PrecisionCadExecutionContext) => Promise<AgentToolCallOutput>;
};

type ExecutorFactoryOptions = {
  binding?: RemotePrecisionCadProjectBinding;
  projectRoot?: string;
  invoke?: TauriInvoke;
};

/** Native execution adapter retained for installed sidecar fallback. */
export function createTauriPrecisionCadExecutor(invoke?: TauriInvoke): PrecisionCadAgentExecutor {
  return {
    catalog: async (context) => {
      if (!context.projectRoot?.trim()) throw new Error('PROJECT_ROOT_REQUIRED');
      return invokeAgentToolCatalog(context.projectRoot, invoke);
    },
    turn: (input) => invokeAiAgentTurn(input, invoke),
    tool: async (input, context) => {
      if (!context.projectRoot?.trim()) throw new Error('PROJECT_ROOT_REQUIRED');
      return invokeAgentToolCall({ ...input, projectRoot: context.projectRoot }, invoke);
    },
  };
}

/** Browser defaults to remote when a cloud project identity is available. */
export function createDefaultPrecisionCadExecutor(options: ExecutorFactoryOptions): PrecisionCadAgentExecutor {
  if (options.binding) return createRemotePrecisionCadExecutor();
  return createTauriPrecisionCadExecutor(options.invoke);
}
