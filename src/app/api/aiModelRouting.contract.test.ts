import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = (...segments: string[]) => readFileSync(join(process.cwd(), ...segments), 'utf8');

describe('public chat model routing contract', () => {
  it.each([
    ['eng-chat', source('src', 'app', 'api', 'eng-chat', 'route.ts')],
    ['eng-chat action', source('src', 'app', 'api', 'eng-chat', 'action', 'route.ts')],
    ['drawing compose', source('src', 'app', 'api', 'nexyfab', 'drawing', 'compose', 'route.ts')],
    ['drawing assemble', source('src', 'app', 'api', 'nexyfab', 'drawing', 'assemble', 'route.ts')],
  ])('%s resolves stable catalog IDs server-side', (_name, routeSource) => {
    expect(routeSource).toContain('resolveRuntimeCodegenModel');
    expect(routeSource).toContain("typeof body.modelId === 'string'");
    expect(routeSource).toContain("selectedModel.code === 'MODEL_NOT_FOUND'");
  });

  it('uses the selected provider/model for both chat completion paths', () => {
    for (const routeSource of [
      source('src', 'app', 'api', 'eng-chat', 'route.ts'),
      source('src', 'app', 'api', 'eng-chat', 'action', 'route.ts'),
    ]) {
      expect(routeSource).toContain('provider: selectedModel.provider');
      expect(routeSource).toContain('model: selectedModel.model');
      expect(routeSource).toContain('allowProviderFallback: true');
    }
  });

  it('pins CAD JSON planning and correction rounds to the selected runtime model', () => {
    const compose = source('src', 'app', 'api', 'nexyfab', 'drawing', 'compose', 'route.ts');
    const assemble = source('src', 'app', 'api', 'nexyfab', 'drawing', 'assemble', 'route.ts');
    expect(compose).toContain('models: [selectedModel.model]');
    expect(assemble).toContain('const requestAiOpts = { ...AI_OPTS, models: [selectedModel.model] }');
    expect(assemble).toContain('const requestClaimsOpts = { ...CLAIMS_OPTS, models: [selectedModel.model] }');
    expect(compose.indexOf('const selectedModel = await resolveRuntimeCodegenModel')).toBeLessThan(compose.indexOf('guardStudioAi(req)'));
    expect(assemble.indexOf('const selectedModel = await resolveRuntimeCodegenModel')).toBeLessThan(assemble.indexOf('guardStudioAi(req)'));
  });
});
