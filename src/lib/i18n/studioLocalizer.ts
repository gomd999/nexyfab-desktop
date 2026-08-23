import { createFlatCatalogLocalizer } from './catalogLocalizer';

export function createStudioLocalizer(lang: string | undefined | null, catalog?: Record<string, string>) {
  return createFlatCatalogLocalizer(lang, catalog);
}
