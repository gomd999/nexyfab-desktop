import { describe, expect, it } from 'vitest';
import {
  createAiDesignChatFirstWorkspaceContract,
  validateAiDesignChatFirstWorkspaceContract,
} from '../aiDesignChatFirstWorkspaceContract';

describe('chat-first unified design workspace contract', () => {
  it('accepts all four multimodal intake forms and starts with an actionable card', () => {
    const contract = createAiDesignChatFirstWorkspaceContract({
      receivedInputs: ['text', 'drawing_2d', 'image_or_sketch', 'existing_3d'],
    });
    expect(contract.acceptedInputs).toEqual(['text', 'drawing_2d', 'image_or_sketch', 'existing_3d']);
    expect(contract.starterCards.length).toBeGreaterThan(0);
    expect(contract.nextRecommendedAction.id).toBe('add_input');
    expect(validateAiDesignChatFirstWorkspaceContract(contract)).toEqual([]);
  });

  it('keeps mobile chat primary and desktop split visual-first', () => {
    const mobile = createAiDesignChatFirstWorkspaceContract({ layout: 'mobile_chat_first' });
    const desktop = createAiDesignChatFirstWorkspaceContract({ layout: 'desktop_split' });
    expect(mobile.regions).toEqual({ chat: 'primary', visualWorkspace: 'supporting', candidates: 'supporting' });
    expect(desktop.regions).toEqual({ chat: 'supporting', visualWorkspace: 'primary', candidates: 'primary' });
  });

  it('makes the concept-to-Precision CAD boundary explicit at every stage', () => {
    const concept = createAiDesignChatFirstWorkspaceContract({ stage: 'edit', receivedInputs: ['text'] });
    const precision = createAiDesignChatFirstWorkspaceContract({ stage: 'precision', receivedInputs: ['existing_3d'] });
    expect(concept.authority.current).toBe('concept_only');
    expect(precision.authority.current).toBe('precision_cad_exact_manufacturing');
    expect(concept.authority.manufacturingReleaseAllowed).toBe(false);
    expect(precision.authority.exactGeometryAuthority).toBe('precision-cad');
    expect(precision.nextRecommendedAction.id).toBe('request_precision_cad');
  });

  it('uses Korean starter cards and falls back to English for unknown locales', () => {
    const contract = createAiDesignChatFirstWorkspaceContract({ locale: 'ko' });
    expect(contract.locale).toBe('ko');
    expect(contract.starterCards.every(card => card.locale === 'ko')).toBe(true);
    const fallback = createAiDesignChatFirstWorkspaceContract({ locale: 'fr' });
    expect(fallback.starterCards.every(card => card.locale === 'en')).toBe(true);
  });

  it.each(['ko', 'en', 'ja', 'zh', 'es', 'ar'] as const)('uses native %s copy across starter, action, and authority boundaries', locale => {
    const contract = createAiDesignChatFirstWorkspaceContract({ locale, stage: 'precision', receivedInputs: ['existing_3d'] });
    expect(contract.starterCards.every(card => card.locale === locale)).toBe(true);
    expect(contract.starterCards.every(card => card.title.trim() && card.description.trim() && card.examplePrompt.trim())).toBe(true);
    expect(contract.nextRecommendedAction.label.trim()).not.toBe('');
    expect(contract.authority.boundaryCopy.trim()).not.toBe('');
    expect(validateAiDesignChatFirstWorkspaceContract(contract)).toEqual([]);
  });
});
