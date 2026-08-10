import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import {
  BIM_REGISTRY_SCHEMA,
  validateBimInformationRegistry,
  type BimClassificationEntry,
  type BimInformationRegistry,
  type BimPropertyDefinition,
  type BimSourceReference,
  type BimStage,
  type BimUnitDefinition,
  type BimValueType,
} from '../../src/lib/bim/informationRegistry';
import { LH_SITE_BEP_REQUIREMENTS, LH_SITE_BEP_SOURCE } from '../../src/lib/bim/lhSiteBepCatalog';

interface FormulaFinding {
  workbook: string;
  sheet: string;
  cell: string;
  formula: string;
  result: unknown;
  error?: string;
}

const EXCEL_ERROR = /#(?:NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|SPILL!|CALC!)/i;
const ALL_STAGES: BimStage[] = ['common', 'design', 'construction', 'maintenance'];

async function walk(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(fullPath));
    else if (entry.name.toLowerCase().endsWith('.xlsx')) files.push(fullPath);
  }
  return files;
}

function plainValue(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if ('richText' in value) return value.richText.map(part => part.text).join('');
  if ('formula' in value) return value.result ?? null;
  if ('text' in value) return value.text;
  if ('error' in value) return value.error;
  return String(value);
}

function textValue(cell: ExcelJS.Cell): string {
  const value = plainValue(cell.value);
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function safeId(value: string): string {
  return [...value].map(character => /[A-Za-z0-9_-]/.test(character) ? character : `u${character.codePointAt(0)!.toString(16)}`).join('').slice(0, 180);
}

function mapType(raw: string): Exclude<BimValueType, 'object' | 'array'> | null {
  const value = raw.replace(/\s+/g, '').toLowerCase();
  if (['문자', '문자열', 'string', 'text'].includes(value)) return 'string';
  if (['숫자', '수치', 'number', '실수'].includes(value)) return 'number';
  if (['정수', 'integer'].includes(value)) return 'integer';
  if (['논리', 'boolean', 'bool'].includes(value)) return 'boolean';
  if (['날짜', 'date'].includes(value)) return 'date';
  return null;
}

function unitCode(raw: string): string {
  const value = raw.trim();
  if (!value || value === '-') return 'none';
  const known: Record<string, string> = { mm: 'mm', m: 'm', '㎡': 'm2', 'm²': 'm2', m2: 'm2', '㎥': 'm3', 'm³': 'm3', m3: 'm3', kg: 'kg', '%': 'percent' };
  return known[value] ?? `source_${[...value].map(character => character.codePointAt(0)!.toString(16)).join('_')}`;
}

function unitDimension(code: string): BimUnitDefinition['dimension'] {
  if (code === 'none') return 'none';
  if (code === 'mm' || code === 'm') return 'length';
  if (code === 'm2') return 'area';
  if (code === 'm3') return 'volume';
  if (code === 'kg') return 'mass';
  if (code === 'percent') return 'ratio';
  return 'custom';
}

function requiredStages(worksheet: ExcelJS.Worksheet, rowNumber: number): BimStage[] {
  const common = textValue(worksheet.getCell(rowNumber, 8)) === '○';
  if (common) return [...ALL_STAGES];
  const stages: BimStage[] = [];
  if (textValue(worksheet.getCell(rowNumber, 9)) === '○') stages.push('design');
  if (textValue(worksheet.getCell(rowNumber, 10)) === '○') stages.push('construction');
  if (textValue(worksheet.getCell(rowNumber, 11)) === '○') stages.push('maintenance');
  return stages;
}

function formulaFinding(workbook: string, worksheet: ExcelJS.Worksheet, cell: ExcelJS.Cell): FormulaFinding | null {
  const value = cell.value;
  if (!value || typeof value !== 'object' || !('formula' in value)) return null;
  const result = value.result ?? null;
  const rendered = typeof result === 'object' && result !== null && 'error' in result ? result.error : result;
  const match = EXCEL_ERROR.exec(`${value.formula} ${String(rendered ?? '')}`);
  return { workbook, sheet: worksheet.name, cell: cell.address, formula: String(value.formula ?? ''), result: rendered, ...(match?.[0] ? { error: match[0] } : {}) };
}

function extractClassifications(worksheet: ExcelJS.Worksheet, sourceRef: string): BimClassificationEntry[] {
  const columns = [
    { scheme: 'OBS' as const, level: 1, code: 2, name: 3 },
    { scheme: 'OBS' as const, level: 2, code: 4, name: 5 },
    { scheme: 'OBS' as const, level: 3, code: 6, name: 7 },
    { scheme: 'OBS' as const, level: 4, code: 8, name: 9 },
    { scheme: 'WBS' as const, level: 5, code: 10, name: 11 },
    { scheme: 'WBS' as const, level: 6, code: 12, name: 13 },
    { scheme: 'WBS' as const, level: 7, code: 14, name: 15 },
    { scheme: 'WBS' as const, level: 7, code: 16, name: 17 },
  ];
  const entries: BimClassificationEntry[] = [];
  const seen = new Set<string>();
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber < 7) return;
    for (const column of columns) {
      const code = textValue(worksheet.getCell(rowNumber, column.code));
      const name = textValue(worksheet.getCell(rowNumber, column.name));
      const id = `${column.scheme}:${code}`;
      if (!code || !name || seen.has(id)) continue;
      seen.add(id);
      entries.push({ scheme: column.scheme, code, name, level: column.level, sourceRef });
    }
  });
  return entries;
}

async function sha256(file: string): Promise<string> {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

export async function auditBimGuidelineRegistry(root: string, bepAudit?: { status?: unknown }) {
  const files = (await walk(root)).sort();
  const workbookInventory: Array<{ path: string; sha256: string; sheets: number }> = [];
  const formulaFindings: FormulaFinding[] = [];
  const classificationsByWorkbook: Array<{ workbook: string; sourceRef: string; entries: BimClassificationEntry[] }> = [];
  const properties: BimPropertyDefinition[] = [];
  const sourceReferences: BimSourceReference[] = [];
  const typeVocabulary = new Map<string, number>();
  const unitVocabulary = new Map<string, number>();
  const unknownTypes: Array<{ workbook: string; sheet: string; row: number; value: string }> = [];
  const sourceFormulaTexts: Array<{ workbook: string; sheet: string; row: number; property: string; formula: string }> = [];
  const duplicatePropertyIds = new Set<string>();
  const propertyIds = new Set<string>();

  for (const [fileIndex, file] of files.entries()) {
    const relativePath = path.relative(root, file);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(file);
    workbookInventory.push({ path: relativePath, sha256: await sha256(file), sheets: workbook.worksheets.length });

    for (const worksheet of workbook.worksheets) {
      worksheet.eachRow({ includeEmpty: false }, row => row.eachCell({ includeEmpty: false }, cell => {
        const finding = formulaFinding(relativePath, worksheet, cell);
        if (finding) formulaFindings.push(finding);
      }));
    }

    const dictionary = workbook.getWorksheet('사전식');
    if (dictionary && textValue(dictionary.getCell(2, 2)) === 'Level 1') {
      const sourceRef = `wbs-obs-${fileIndex}`;
      sourceReferences.push({ id: sourceRef, path: relativePath, sheet: dictionary.name, revision: '2025.12', access: 'read_only' });
      classificationsByWorkbook.push({ workbook: relativePath, sourceRef, entries: extractClassifications(dictionary, sourceRef) });
    }

    const whole = workbook.getWorksheet('전체');
    if (!whole || !textValue(whole.getCell(1, 1)).includes('BIM')) continue;
    for (const worksheet of workbook.worksheets) {
      if (!worksheet.name.startsWith('객체_')) continue;
      const sourceRef = `pset-${fileIndex}-${safeId(worksheet.name)}`;
      sourceReferences.push({ id: sourceRef, path: relativePath, sheet: worksheet.name, revision: 'LHBIMv0.1', access: 'read_only' });
      worksheet.eachRow({ includeEmpty: false }, (_row, rowNumber) => {
        if (rowNumber < 11) return;
        const key = textValue(worksheet.getCell(rowNumber, 4));
        const name = textValue(worksheet.getCell(rowNumber, 3));
        const rawType = textValue(worksheet.getCell(rowNumber, 5));
        if (!key || !name || !rawType) return;
        typeVocabulary.set(rawType, (typeVocabulary.get(rawType) ?? 0) + 1);
        const type = mapType(rawType);
        if (!type) {
          unknownTypes.push({ workbook: relativePath, sheet: worksheet.name, row: rowNumber, value: rawType });
          return;
        }
        const rawUnit = textValue(worksheet.getCell(rowNumber, 6));
        unitVocabulary.set(rawUnit || '-', (unitVocabulary.get(rawUnit || '-') ?? 0) + 1);
        const id = `${worksheet.name}.${key}`;
        if (propertyIds.has(id)) {
          duplicatePropertyIds.add(id);
          return;
        }
        propertyIds.add(id);
        const sourceFormula = textValue(worksheet.getCell(rowNumber, 13));
        if (sourceFormula) sourceFormulaTexts.push({ workbook: relativePath, sheet: worksheet.name, row: rowNumber, property: key, formula: sourceFormula });
        properties.push({
          pset: worksheet.name,
          key,
          name,
          type,
          unit: unitCode(rawUnit),
          requiredAt: requiredStages(worksheet, rowNumber),
          description: textValue(worksheet.getCell(rowNumber, 12)) || undefined,
          sourceRef,
        });
      });
    }
  }

  const units: BimUnitDefinition[] = [...new Set(['none', ...properties.map(property => property.unit)])]
    .sort((a, b) => a.localeCompare(b))
    .map(code => ({ code, symbol: code === 'none' ? '-' : code, dimension: unitDimension(code) }));
  const psetRegistry: BimInformationRegistry = {
    schema: BIM_REGISTRY_SCHEMA,
    registryId: 'lh-site-pset-candidate',
    version: 'LHBIMv0.1+audit.2025.12',
    sourceReferences: [...sourceReferences.filter(source => source.id.startsWith('pset-')), LH_SITE_BEP_SOURCE],
    units,
    classifications: [],
    properties,
    bepRequirements: [...LH_SITE_BEP_REQUIREMENTS],
  };
  const psetValidation = validateBimInformationRegistry(psetRegistry);
  const classificationRegistries = classificationsByWorkbook.map(item => {
    const source = sourceReferences.find(candidate => candidate.id === item.sourceRef)!;
    const registry: BimInformationRegistry = {
      schema: BIM_REGISTRY_SCHEMA,
      registryId: `lh-site-wbs-obs-${safeId(path.basename(item.workbook, '.xlsx'))}`,
      version: '2025.12',
      sourceReferences: [source], units: [{ code: 'none', symbol: '-', dimension: 'none' }],
      classifications: item.entries, properties: [], bepRequirements: [],
    };
    const validation = validateBimInformationRegistry(registry);
    return {
      workbook: item.workbook,
      counts: {
        total: item.entries.length,
        WBS: item.entries.filter(entry => entry.scheme === 'WBS').length,
        OBS: item.entries.filter(entry => entry.scheme === 'OBS').length,
      },
      validation,
      sample: item.entries.slice(0, 12),
    };
  });
  const formulaErrors = formulaFindings.filter(finding => finding.error);
  const blockers = [
    ...(formulaErrors.length ? [`${formulaErrors.length} Excel formula error cell(s) require source-owner correction or an approved mapping.`] : []),
    ...(unknownTypes.length ? [`${unknownTypes.length} unsupported Pset type row(s) require an explicit type mapping.`] : []),
    ...(duplicatePropertyIds.size ? [`${duplicatePropertyIds.size} duplicate Pset property identifier(s) require disambiguation.`] : []),
    ...(psetValidation.status === 'invalid' ? [`Pset candidate registry has ${psetValidation.issues.length} structural validation issue(s).`] : []),
    ...(bepAudit?.status === 'verified' ? [] : ['The supplied BEP HWP needs a verified deterministic heading-to-contract audit.']),
  ];

  return {
    schema: 'nexyfab.bim-guideline-registry-audit.v1',
    generatedAt: new Date().toISOString(),
    sourcePolicy: { access: 'read_only', sourceMutation: false, generatedPayloadCopies: false },
    workbookInventory,
    summary: {
      workbookCount: workbookInventory.length,
      worksheetCount: workbookInventory.reduce((sum, workbook) => sum + workbook.sheets, 0),
      classificationRegistryCount: classificationRegistries.length,
      psetPropertyCount: properties.length,
      sourceFormulaCellCount: formulaFindings.length,
      sourceFormulaErrorCount: formulaErrors.length,
      psetFormulaTextCount: sourceFormulaTexts.length,
      unknownPsetTypeCount: unknownTypes.length,
      duplicatePsetPropertyCount: duplicatePropertyIds.size,
    },
    classificationRegistries,
    psetCandidate: {
      validation: psetValidation,
      typeVocabulary: Object.fromEntries([...typeVocabulary].sort(([a], [b]) => a.localeCompare(b))),
      unitVocabulary: Object.fromEntries([...unitVocabulary].sort(([a], [b]) => a.localeCompare(b))),
      unknownTypes: unknownTypes.slice(0, 200),
      duplicatePropertyIds: [...duplicatePropertyIds].sort().slice(0, 200),
      sample: properties.slice(0, 30),
    },
    formulaAudit: { errors: formulaErrors.slice(0, 200), psetFormulaTextSample: sourceFormulaTexts.slice(0, 100) },
    bepSourceSpecificImport: { status: bepAudit?.status === 'verified' ? 'verified' : 'not_run', requirementCount: LH_SITE_BEP_REQUIREMENTS.length },
    promotion: { status: blockers.length ? 'blocked' : 'eligible_for_review', blockers },
  };
}

function argument(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const root = argument(args, '--root');
  const out = argument(args, '--out');
  const bepAuditPath = argument(args, '--bep-audit');
  if (!root || !out) throw new Error('usage: tsx scripts/reference/audit-bim-guideline-registry.ts --root <directory> --out <report.json>');
  const bepAudit = bepAuditPath ? JSON.parse(await readFile(path.resolve(bepAuditPath), 'utf8')) as { status?: unknown } : undefined;
  const report = await auditBimGuidelineRegistry(path.resolve(root), bepAudit);
  await mkdir(path.dirname(path.resolve(out)), { recursive: true });
  await writeFile(path.resolve(out), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ summary: report.summary, promotion: report.promotion.status })}\n`);
}

void main();
