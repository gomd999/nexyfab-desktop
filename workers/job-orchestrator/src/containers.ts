import { Container } from '@cloudflare/containers';

export interface ComputeContainerEnv {
  COMPUTE_SHARED_SECRET?: string;
  EXACT_WORKER_IDENTITY_SHA256?: string;
  OPENSCAD_WORKER_IDENTITY_SHA256?: string;
  FEA_WORKER_IDENTITY_SHA256?: string;
  INTEROP_WORKER_IDENTITY_SHA256?: string;
  EXACT_KERNEL_IDENTITY_SHA256?: string;
  INTEROP_KERNEL_IDENTITY_SHA256?: string;
  EXACT_BUILD_ID?: string;
  OPENSCAD_BUILD_ID?: string;
  FEA_BUILD_ID?: string;
  INTEROP_BUILD_ID?: string;
}

abstract class CadComputeContainer extends Container<ComputeContainerEnv> {
  override defaultPort = 8080;
  override requiredPorts = [8080];
  override sleepAfter = '2m';
  override pingEndpoint = '/healthz';
  override enableInternet = true;
  protected readonly bindingEnv: ComputeContainerEnv;

  constructor(ctx: ConstructorParameters<typeof Container>[0], env: ComputeContainerEnv) {
    super(ctx, env);
    this.bindingEnv = env;
  }

  protected abstract runtimeEnv(): Record<string, string | undefined>;

  override async fetch(request: Request): Promise<Response> {
    const values = this.runtimeEnv();
    const missing = Object.entries(values).filter(([, value]) => !value).map(([name]) => name);
    if (missing.length) {
      return new Response(JSON.stringify({ ok: false, code: 'CONTAINER_ENV_NOT_CONFIGURED', missing }), {
        status: 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      });
    }
    this.envVars = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value!]));
    return super.fetch(request);
  }
}

export class ExactComputeContainer extends CadComputeContainer {
  protected override runtimeEnv() {
    return {
      NEXYFAB_COMPUTE_SHARED_SECRET: this.bindingEnv.COMPUTE_SHARED_SECRET,
      NEXYFAB_WORKER_IDENTITY_SHA256: this.bindingEnv.EXACT_WORKER_IDENTITY_SHA256,
      NEXYFAB_KERNEL_IDENTITY_SHA256: this.bindingEnv.EXACT_KERNEL_IDENTITY_SHA256,
      NEXYFAB_WORKER_BUILD_ID: this.bindingEnv.EXACT_BUILD_ID,
    };
  }
}

export class OpenScadComputeContainer extends CadComputeContainer {
  protected override runtimeEnv() {
    return {
      NEXYFAB_COMPUTE_SHARED_SECRET: this.bindingEnv.COMPUTE_SHARED_SECRET,
      NEXYFAB_WORKER_IDENTITY_SHA256: this.bindingEnv.OPENSCAD_WORKER_IDENTITY_SHA256,
      NEXYFAB_WORKER_BUILD_ID: this.bindingEnv.OPENSCAD_BUILD_ID,
    };
  }
}

export class FeaComputeContainer extends CadComputeContainer {
  protected override runtimeEnv() {
    return {
      NEXYFAB_COMPUTE_SHARED_SECRET: this.bindingEnv.COMPUTE_SHARED_SECRET,
      NEXYFAB_WORKER_IDENTITY_SHA256: this.bindingEnv.FEA_WORKER_IDENTITY_SHA256,
      NEXYFAB_WORKER_BUILD_ID: this.bindingEnv.FEA_BUILD_ID,
    };
  }
}

export class InteropComputeContainer extends CadComputeContainer {
  protected override runtimeEnv() {
    return {
      NEXYFAB_COMPUTE_SHARED_SECRET: this.bindingEnv.COMPUTE_SHARED_SECRET,
      NEXYFAB_WORKER_IDENTITY_SHA256: this.bindingEnv.INTEROP_WORKER_IDENTITY_SHA256,
      NEXYFAB_KERNEL_IDENTITY_SHA256: this.bindingEnv.INTEROP_KERNEL_IDENTITY_SHA256,
      NEXYFAB_WORKER_BUILD_ID: this.bindingEnv.INTEROP_BUILD_ID,
    };
  }
}
