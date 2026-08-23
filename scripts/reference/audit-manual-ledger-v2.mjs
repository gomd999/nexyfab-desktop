#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(process.cwd());
const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const indexPath = path.resolve(option('index') ?? 'docs/cad-program/requirements/manual-index.json');
const requirementsPath = path.resolve(option('requirements') ?? 'docs/cad-program/requirements/manual-requirements.json');
const outputPath = path.resolve(option('output') ?? 'docs/cad-program/requirements/manual-ledger-v2.json');
const checkOnly = process.argv.includes('--check');
const SHA256 = /^[a-f0-9]{64}$/;
const EXPECTED_UNMAPPED_MANUAL_IDS = [];

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function sorted(values) {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

function sourceAnchor(requirement, manualId) {
  // A manual ID identifies the indexed source document, but it is not a page or section citation.
  // Do not infer a locator from the PDF filename or approximate page count.
  const locator = requirement.sourceLocators?.[manualId] ?? requirement.sourceReferences?.[manualId] ?? null;
  const hasDocument = locator && (locator.documentId === manualId || locator.sourceDocumentId === manualId);
  const hasPage = hasDocument && Number.isInteger(locator.page) && locator.page > 0;
  const hasSection = hasDocument && typeof locator.section === 'string' && locator.section.trim().length > 0;
  return {
    documentId: manualId,
    page: hasPage ? locator.page : null,
    section: hasSection ? locator.section.trim() : null,
    status: hasPage && hasSection ? 'BOUND' : 'HOLD',
  };
}

function buildLedger(index, requirements) {
  if (index.count !== 20 || !Array.isArray(index.documents) || index.documents.length !== 20) throw new Error('manual index must contain exactly 20 documents');
  const documents = [...index.documents].sort((a, b) => a.documentId.localeCompare(b.documentId));
  const documentById = new Map();
  for (const document of documents) {
    if (!/^MANUAL-\d{2}$/.test(document.documentId) || documentById.has(document.documentId) || !SHA256.test(document.sha256)) throw new Error(`invalid manual index document: ${document.documentId}`);
    documentById.set(document.documentId, document);
  }
  const baseline = Array.isArray(requirements.requirements) ? requirements.requirements : [];
  const scenario = requirements.architectureInteriorScenarioRequirementContract?.requirements ?? [];
  const contractRequirements = [...baseline, ...scenario].sort((a, b) => a.id.localeCompare(b.id));
  const requirementIds = new Set();
  const requirementByManual = new Map(documents.map(document => [document.documentId, []]));
  const unmappedRequirementIds = [];
  for (const requirement of contractRequirements) {
    if (requirementIds.has(requirement.id)) throw new Error(`duplicate atomic requirement: ${requirement.id}`);
    requirementIds.add(requirement.id);
    const manualIds = Array.isArray(requirement.sourceManualIds) ? sorted(new Set(requirement.sourceManualIds)) : [];
    if (manualIds.length === 0) unmappedRequirementIds.push(requirement.id);
    for (const manualId of manualIds) {
      const document = documentById.get(manualId);
      if (!document) throw new Error(`unknown source manual: ${requirement.id}:${manualId}`);
      if (requirement.sourceHashes && requirement.sourceHashes[manualId] !== document.sha256) throw new Error(`source hash mismatch: ${requirement.id}:${manualId}`);
      requirementByManual.get(manualId).push({
        requirementId: requirement.id,
        domain: requirement.domain,
        action: requirement.action,
        status: requirement.status,
        sourceAnchor: sourceAnchor(requirement, manualId),
      });
    }
  }
  const rows = documents.map(document => {
    const mappings = requirementByManual.get(document.documentId).sort((a, b) => a.requirementId.localeCompare(b.requirementId));
    const verified = mappings.filter(item => item.sourceAnchor.status === 'BOUND').map(item => item.requirementId);
    const mapped = mappings.map(item => item.requirementId);
    return {
      manualId: document.documentId,
      fileName: document.fileName,
      sha256: document.sha256,
      family: document.family,
      domains: document.domains,
      functionalCoverage: {
        status: mapped.length > 0 ? 'mapped' : 'unmapped',
        mappedRequirementIds: mapped,
        mappedRequirementCount: mapped.length,
        unmappedRequirementIds: mapped.length > 0 ? [] : contractRequirements.map(item => item.id),
        verifiedRequirementIds: verified,
        verifiedRequirementCount: verified.length,
        unmappedRequirementCount: mapped.length > 0 ? 0 : contractRequirements.length,
      },
      sourceAnchors: {
        status: verified.length > 0 ? 'BOUND' : 'HOLD',
        locators: mappings.map(item => ({ requirementId: item.requirementId, ...item.sourceAnchor })),
      },
      review: {
        status: 'HOLD',
        reason: verified.length > 0 ? 'reviewer_receipt_missing' : mapped.length > 0 ? 'source_page_section_missing' : 'no_functional_requirement_mapping',
        scoreEligible: false,
      },
    };
  });
  const mappedManualIds = rows.filter(row => row.functionalCoverage.status === 'mapped').map(row => row.manualId);
  const unmappedManualIds = rows.filter(row => row.functionalCoverage.status === 'unmapped').map(row => row.manualId);
  if (JSON.stringify(unmappedManualIds) !== JSON.stringify(EXPECTED_UNMAPPED_MANUAL_IDS)) throw new Error(`unexpected unmapped manual set: ${unmappedManualIds.join(',')}`);
  const verifiedManualIds = rows.filter(row => row.functionalCoverage.verifiedRequirementCount > 0).map(row => row.manualId);
  const ledger = {
    schema: 'nexyfab.manual-ledger.v2',
    policy: {
      sourceReadOnly: true,
      sourceBytesCopied: false,
      pageOrSectionRequiredForVerified: true,
      missingLocatorTruth: 'HOLD',
      noSourceGuessing: true,
    },
    sourceIndex: {
      path: path.relative(root, indexPath).replaceAll('\\', '/'),
      sha256: sha256File(indexPath),
      manualCount: documents.length,
    },
    sourceRequirements: {
      path: path.relative(root, requirementsPath).replaceAll('\\', '/'),
      sha256: sha256File(requirementsPath),
      requirementCount: contractRequirements.length,
      atomicRequirementCount: contractRequirements.filter(item => item.atomic === true).length,
      unmappedRequirementIds: sorted(unmappedRequirementIds),
    },
    summary: {
      manualCount: documents.length,
      mappedManualCount: mappedManualIds.length,
      unmappedManualCount: unmappedManualIds.length,
      mappedManualIds,
      unmappedManualIds,
      verifiedManualIds,
      holdManualIds: rows.map(row => row.manualId),
      allManualsScoreEligible: false,
    },
    manuals: rows,
  };
  return ledger;
}

function main() {
  const index = readJson(indexPath);
  const requirements = readJson(requirementsPath);
  const ledger = buildLedger(index, requirements);
  const encoded = `${JSON.stringify(ledger, null, 2)}\n`;
  if (checkOnly) {
    if (!existsSync(outputPath)) throw new Error(`ledger output missing: ${outputPath}`);
    const existing = readFileSync(outputPath, 'utf8');
    if (existing !== encoded) throw new Error(`ledger output is stale or non-deterministic: ${outputPath}`);
    process.stdout.write(`manual ledger valid: ${ledger.summary.manualCount} manuals, ${ledger.sourceRequirements.requirementCount} requirements (${ledger.sourceRequirements.atomicRequirementCount} atomic), ${ledger.summary.mappedManualCount} mapped, ${ledger.summary.unmappedManualCount} unmapped\n`);
    return;
  }
  writeFileSync(outputPath, encoded);
  process.stdout.write(`manual ledger written: ${outputPath}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try { main(); } catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}

export { buildLedger, canonical };
