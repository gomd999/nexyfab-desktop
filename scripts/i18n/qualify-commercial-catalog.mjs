#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { qualifyCommercialCatalog } from './commercial-catalog.mjs';

const catalog = JSON.parse(readFileSync('src/lib/i18n/commercialTranslations.generated.json', 'utf8'));
const result = qualifyCommercialCatalog(catalog);
console.log(`commercial i18n catalog: ${result.pairs.length} source pairs, ${result.missing.length} missing, ${result.invalid.length} invalid, ${result.legacyBilingualLiterals.length} legacy branches`);
if (result.missing.length > 0) {
  for (const pair of result.missing.slice(0, 30)) console.error(`missing: ${pair.en} (${pair.file})`);
}
if (result.invalid.length > 0) {
  for (const item of result.invalid.slice(0, 30)) console.error(`invalid ${item.locale}/${item.reason}: ${item.en} (${item.file})`);
}
if (result.legacyBilingualLiterals.length > 0) {
  for (const item of result.legacyBilingualLiterals.slice(0, 30)) console.error(`legacy bilingual branch: ${item.file}:${item.line}`);
}
if (!result.ok) process.exitCode = 1;
