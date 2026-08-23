declare module 'cloudflare:workers' {
  export class WorkflowEntrypoint<Env = unknown, Params = unknown> {
    protected env: Env;
    constructor(ctx: unknown, env: Env);
    run(event: WorkflowEvent<Params>, step: WorkflowStep): Promise<unknown>;
  }
  export interface WorkflowEvent<Params = unknown> { payload: Params }
  export interface WorkflowStep {
    do<T>(name: string, callback: () => Promise<T>): Promise<T>;
    do<T>(name: string, config: Record<string, unknown>, callback: () => Promise<T>): Promise<T>;
  }
}
