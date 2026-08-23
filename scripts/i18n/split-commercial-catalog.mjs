#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { extractCommercialPairs } from './commercial-catalog.mjs';

const catalog = JSON.parse(readFileSync('src/lib/i18n/commercialTranslations.generated.json', 'utf8'));
const pairs = extractCommercialPairs('src/app/[lang]/studio');
const subset = Object.fromEntries(pairs.map(({ en }) => [en, catalog[en]]));
const missing = Object.entries(subset).filter(([, value]) => !value).map(([key]) => key);
if (missing.length > 0) throw new Error(`studio catalog missing ${missing.length}: ${missing.slice(0, 5).join(', ')}`);
writeFileSync('src/lib/i18n/studioTranslations.generated.json', `${JSON.stringify(subset, null, 2)}\n`, 'utf8');
console.log(`wrote ${Object.keys(subset).length} Studio translations`);
