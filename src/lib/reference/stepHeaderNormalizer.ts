import { createHash } from 'node:crypto';

export interface StepHeaderRepair {
  kind: 'file-name-authorisation-unset-to-empty-string';
  originalSha256: string;
  repairedSha256: string;
  dataSha256: string;
}

export type StepHeaderNormalizationResult =
  | { ok: true; source: string; repair: StepHeaderRepair }
  | { ok: false; reason: 'invalid-envelope' | 'ambiguous-sections' | 'ambiguous-file-name' | 'not-applicable' | 'unsafe-file-name' };

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

/**
 * Repair one narrowly known Part 21 interoperability defect. The DATA suffix
 * is sliced out before matching and must remain byte-for-byte identical.
 */
export function normalizeStepHeaderAuthorisation(source: string): StepHeaderNormalizationResult {
  const dataMarkers = [...source.matchAll(/(?:^|\r?\n)DATA\s*;/gi)];
  if (dataMarkers.length !== 1) return { ok: false, reason: 'ambiguous-sections' };
  const marker = dataMarkers[0]!;
  const dataStart = marker.index! + marker[0].indexOf('DATA');
  const header = source.slice(0, dataStart), data = source.slice(dataStart);
  if (!/^\s*ISO-10303-21\s*;/i.test(header) || !/\bHEADER\s*;/i.test(header) || !/\bENDSEC\s*;\s*$/i.test(header)) {
    return { ok: false, reason: 'invalid-envelope' };
  }
  const matches = [...header.matchAll(/\bFILE_NAME\s*\(([\s\S]*?)\)\s*;/gi)];
  if (matches.length !== 1) return { ok: false, reason: 'ambiguous-file-name' };
  const statement = matches[0]![0], offset = matches[0]!.index!;
  // Comments and quoted strings may contain commas. Require the exact known
  // final-token defect, and reject any other `$` so this cannot become a
  // general STEP rewriter.
  const statementDollars = (statement.match(/\$/g) ?? []).length;
  const headerDollars = (header.match(/\$/g) ?? []).length;
  if (statementDollars === 0 && headerDollars === 0) return { ok: false, reason: 'not-applicable' };
  if (statementDollars !== 1 || headerDollars !== 1) return { ok: false, reason: 'unsafe-file-name' };
  const repairedStatement = statement.replace(/\$\s*\)\s*;$/, "'');");
  if (repairedStatement === statement) return { ok: false, reason: 'unsafe-file-name' };
  const repairedHeader = header.slice(0, offset) + repairedStatement + header.slice(offset + statement.length);
  const repaired = repairedHeader + data;
  if (!repaired.endsWith(data)) return { ok: false, reason: 'unsafe-file-name' };
  return {
    ok: true, source: repaired,
    repair: { kind: 'file-name-authorisation-unset-to-empty-string', originalSha256: sha(source), repairedSha256: sha(repaired), dataSha256: sha(data) },
  };
}
