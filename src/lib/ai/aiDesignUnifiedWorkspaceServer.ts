import 'server-only';

import { loadAiDesignComplexWorkspaceReadModel } from './aiDesignComplexWorkspaceService';
import { createAiDesignComplexWorkspaceUxV2, type AiDesignWorkspaceLocale } from './aiDesignComplexWorkspaceUxV2';
import { createAiDesignUnifiedWorkspaceV9 } from './aiDesignUnifiedWorkspaceV9';

export async function loadAiDesignUnifiedWorkspaceServerV10(
  ownerKey: string,
  projectId: string,
  sessionId: string,
  locale = 'en',
) {
  const normalizedLocale: AiDesignWorkspaceLocale = locale === 'kr' ? 'ko'
    : ['ko', 'en', 'ja', 'zh', 'cn', 'es', 'ar'].includes(locale) ? locale as AiDesignWorkspaceLocale : 'en';
  const model = await loadAiDesignComplexWorkspaceReadModel(ownerKey, projectId, sessionId);
  const ux = createAiDesignComplexWorkspaceUxV2(model, { locale: normalizedLocale });
  const unified = createAiDesignUnifiedWorkspaceV9(model, { locale: normalizedLocale, recovery: ux.recovery });
  return { model, ux, unified };
}
