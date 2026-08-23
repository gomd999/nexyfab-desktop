export type AiProvider = 'openai' | 'anthropic';

export type ProviderStatus = {
  provider: AiProvider;
  has_credential: boolean;
};

export type ConnectivityStatus = {
  provider: AiProvider;
  ok: boolean;
  code: 'ok' | 'unauthorized' | 'forbidden' | 'timeout' | 'network_error' | 'http_error';
};

export type AgentRuntimeInfo = {
  supported: boolean;
  exists: boolean;
  path: string | null;
  profile: 'installer-core';
  error_code: 'AGENT_SIDECAR_MISSING' | 'AGENT_RUNTIME_UNSUPPORTED' | null;
};

export type ProviderBridgeErrorCode =
  | 'desktop_unavailable'
  | 'invalid_provider'
  | 'invalid_credential'
  | 'keyring_unavailable'
  | 'credential_missing'
  | 'credential_save_failed'
  | 'credential_delete_failed'
  | 'connectivity_network';

export class ProviderBridgeError extends Error {
  readonly code: ProviderBridgeErrorCode;

  constructor(code: ProviderBridgeErrorCode) {
    super(code);
    this.name = 'ProviderBridgeError';
    this.code = code;
  }
}

export const AI_PROVIDERS: readonly AiProvider[] = ['openai', 'anthropic'];

export function isAiProvider(value: string): value is AiProvider {
  return AI_PROVIDERS.includes(value as AiProvider);
}

function bridgeError(value: unknown): ProviderBridgeError {
  if (value instanceof ProviderBridgeError) return value;
  if (typeof value === 'object' && value !== null && 'code' in value) {
    const code = (value as { code?: unknown }).code;
    if (typeof code === 'string' && [
      'invalid_provider', 'invalid_credential', 'keyring_unavailable',
      'credential_missing', 'credential_save_failed', 'credential_delete_failed',
      'connectivity_network',
    ].includes(code)) return new ProviderBridgeError(code as ProviderBridgeErrorCode);
  }
  return new ProviderBridgeError('desktop_unavailable');
}

async function invoke<T>(command: string, args: Record<string, unknown>): Promise<T> {
  try {
    const core = await import('@tauri-apps/api/core');
    return await core.invoke<T>(command, args);
  } catch (error) {
    throw bridgeError(error);
  }
}

export function getProviderStatus(provider: AiProvider): Promise<ProviderStatus> {
  return invoke<ProviderStatus>('ai_provider_status', { provider });
}

export function providerCredentialArgs(provider: AiProvider, apiKey: string) {
  // Tauri maps camelCase JavaScript arguments to snake_case Rust parameters.
  return { provider, apiKey };
}

export function saveProviderCredential(provider: AiProvider, apiKey: string): Promise<ProviderStatus> {
  // The bridge never stores this value. Rust writes it directly to the OS
  // credential store and returns only a redacted status object.
  return invoke<ProviderStatus>('ai_provider_save_credential', providerCredentialArgs(provider, apiKey));
}

export function deleteProviderCredential(provider: AiProvider): Promise<ProviderStatus> {
  return invoke<ProviderStatus>('ai_provider_delete_credential', { provider });
}

export function testProviderConnection(provider: AiProvider): Promise<ConnectivityStatus> {
  return invoke<ConnectivityStatus>('ai_provider_test_connection', { provider });
}

export function getAgentRuntimeInfo(): Promise<AgentRuntimeInfo> {
  return invoke<AgentRuntimeInfo>('agent_runtime_info', {});
}

export function usableAgentRuntime(info: AgentRuntimeInfo): info is AgentRuntimeInfo & { path: string } {
  return info.supported && info.exists && typeof info.path === 'string' && info.path.length > 0;
}
