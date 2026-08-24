import { describe, expect, it } from 'vitest';
import { CAD_MESSAGE_CODES, assertCadMessage, isCadLocale, isCadMessageCode, type CadMessage } from './message';

describe('CAD machine messages', () => {
  it('accepts stable codes and typed params', () => expect(assertCadMessage({ code: 'CAD_REVISION_STALE', params: { revision: 'r1' } }).code).toBe('CAD_REVISION_STALE'));
  it('covers each GP02-GP05 failure boundary with a stable code', () => {
    expect(CAD_MESSAGE_CODES).toEqual(expect.arrayContaining([
      'CAD_INPUT_INVALID', 'CAD_PERMISSION_DENIED', 'CAD_LOCK_CONFLICT',
      'CAD_REVISION_STALE', 'CAD_MIGRATION_REQUIRED', 'CAD_PREFLIGHT_HOLD',
      'CAD_FEATURE_REGISTRY_MISMATCH', 'CAD_RUNTIME_IDENTITY_MISMATCH',
      'CAD_VERIFICATION_FAILED', 'CAD_RELEASE_HOLD',
    ]));
  });
  it('rejects unknown codes and invalid params', () => {
    expect(() => assertCadMessage({ code: 'NOPE' as never })).toThrow('unknown_cad_message_code');
    expect(() => assertCadMessage({ code: 'CAD_REVISION_STALE', params: { revision: true as never } })).toThrow('invalid_cad_message_param');
    expect(() => assertCadMessage({ code: 'CAD_REVISION_STALE', params: {} })).toThrow('invalid_cad_message_param_keys');
    expect(() => assertCadMessage({ code: 'CAD_REVISION_STALE', params: { revision: 1, translated: 'stale' } })).toThrow('invalid_cad_message_param_keys');
    expect(() => assertCadMessage({ code: 'CAD_EXACT_KERNEL_UNAVAILABLE', params: {} })).toThrow('unexpected_cad_message_params');
    expect(() => assertCadMessage({ code: 'CAD_REVISION_STALE', params: { revision: Number.NaN } })).toThrow('invalid_cad_message_param');
    expect(() => assertCadMessage({ code: 'CAD_INPUT_INVALID', params: { reason: '<b>bad</b>' } })).toThrow('invalid_cad_message_param');
    expect(() => assertCadMessage({ code: 'CAD_INPUT_INVALID', detail: '<script>' , params: { reason: 'bad' } })).toThrow('invalid_cad_message_detail');
  });
  it('rejects accessors, throwing proxies, and non-plain prototypes', () => {
    const accessor = {} as Record<string, unknown>;
    Object.defineProperty(accessor, 'code', { get: () => 'CAD_EXACT_KERNEL_UNAVAILABLE', enumerable: true });
    expect(() => assertCadMessage(accessor)).toThrow('invalid_cad_message');
    const throwingProxy = new Proxy({ code: 'CAD_EXACT_KERNEL_UNAVAILABLE' }, {
      getOwnPropertyDescriptor: () => { throw new Error('trap'); },
    });
    expect(() => assertCadMessage(throwingProxy)).toThrow('invalid_cad_message');
    expect(() => assertCadMessage(Object.create({ code: 'CAD_EXACT_KERNEL_UNAVAILABLE' }))).toThrow('invalid_cad_message');
  });
  it('detaches accepted values for safe placeholder rendering', () => {
    const source = { code: 'CAD_FEATURE_UNSUPPORTED' as const, params: { feature: 'A&B' } };
    const message = assertCadMessage(source);
    expect(message).not.toBe(source);
    expect((message as Extract<CadMessage, { code: 'CAD_FEATURE_UNSUPPORTED' }>).params.feature).toBe('A&B');
  });
  it('keeps locale and code guards narrow', () => { expect(isCadLocale('cn')).toBe(false); expect(isCadLocale('zh')).toBe(true); expect(isCadMessageCode('CAD_RECEIPT_INVALID')).toBe(true); });
});
