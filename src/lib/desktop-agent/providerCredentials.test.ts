import { describe, expect, it } from 'vitest';
import {
  AI_PROVIDERS,
  isAiProvider,
  providerCredentialArgs,
  ProviderBridgeError,
  usableAgentRuntime,
} from './providerCredentials';

describe('desktop provider credential bridge helpers', () => {
  it('allows only the two supported providers', () => {
    expect(AI_PROVIDERS).toEqual(['openai', 'anthropic']);
    expect(isAiProvider('openai')).toBe(true);
    expect(isAiProvider('anthropic')).toBe(true);
    expect(isAiProvider('google')).toBe(false);
    expect(isAiProvider('OpenAI')).toBe(false);
  });

  it('keeps bridge errors to stable codes', () => {
    const error = new ProviderBridgeError('keyring_unavailable');
    expect(error.code).toBe('keyring_unavailable');
    expect(error.message).toBe('keyring_unavailable');
  });

  it('uses Tauri camelCase for the Rust api_key argument', () => {
    expect(providerCredentialArgs('openai', 'secret')).toEqual({
      provider: 'openai',
      apiKey: 'secret',
    });
    expect(providerCredentialArgs('openai', 'secret')).not.toHaveProperty('api_key');
  });

  it('accepts only an existing supported installer runtime', () => {
    expect(usableAgentRuntime({ supported: true, exists: true, path: 'C:\\NexyFab\\agent.exe', profile: 'installer-core', error_code: null })).toBe(true);
    expect(usableAgentRuntime({ supported: true, exists: false, path: null, profile: 'installer-core', error_code: 'AGENT_SIDECAR_MISSING' })).toBe(false);
  });
});
