import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { buildAssemblyTemplate, listAssemblyTemplates } from './drawing-to-3d/domain-assemblies.mjs';

const DOMAIN_MAP = {
  mechanical: 'mech', civil: 'civil', building: 'building', landscape: 'landscape', interior: 'interior',
};
const stable = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
  : item);
const clamp = (value, min, max) => Math.min(max ?? value, Math.max(min ?? value, value));

export function buildDomainCandidates(domain, count = 20) {
  const registryDomain = DOMAIN_MAP[domain];
  if (!registryDomain) throw new TypeError(`Unknown domain: ${domain}`);
  if (!Number.isSafeInteger(count) || count < 1) throw new TypeError('count must be a positive integer');
  const templates = listAssemblyTemplates(registryDomain);
  if (!templates.length) throw new TypeError(`No templates registered for ${domain}`);
  const candidates = [];
  const rejected = [];
  for (let index = 0; candidates.length < count && index < count * 20; index++) {
    const template = templates[index % templates.length];
    const cycle = Math.floor(index / templates.length);
    const factor = 0.8 + cycle * 0.04;
    const parameters = Object.fromEntries((template.params ?? []).map(param => {
      const base = Number(param.default);
      const varied = Number.isFinite(base) ? clamp(base * factor, param.min, param.max) : param.default;
      return [param.name, Number.isFinite(varied) ? +varied.toFixed(6) : varied];
    }));
    const assembly = buildAssemblyTemplate(registryDomain, template.id, parameters);
    const artifactHash = createHash('sha256').update(stable(assembly)).digest('hex');
    const source = { domain, templateId: template.id, parameters, artifactHash };
    const sourceHash = createHash('sha256').update(stable(source)).digest('hex');
    const roles = [...new Set((assembly.parts ?? []).map(part => part.role).filter(Boolean))].sort();
    const artifactSummary = {
      name: assembly.name ?? template.labelEn ?? template.id,
      partCount: assembly.parts?.length ?? 0,
      pipeCount: assembly.pipes?.length ?? 0,
      roles,
      alignmentErrors: assembly.alignmentErrors ?? [],
      unverifiedPartCount: (assembly.parts ?? []).filter(part => part.unverified === true).length,
    };
    if (artifactSummary.alignmentErrors.length || artifactSummary.unverifiedPartCount) {
      rejected.push({ templateId: template.id, cycle, artifactHash, artifactSummary });
      continue;
    }
    candidates.push({
      schema: 'nexyfab.domain-accuracy-candidate.v1',
      caseId: `${domain}-${template.id}-${String(cycle + 1).padStart(2, '0')}`,
      domain,
      sourceHash,
      sourceKind: 'internal-template',
      templateId: template.id,
      parameters,
      artifactHash,
      artifactSummary,
      split: 'candidate',
    });
  }
  if (candidates.length < count) throw new Error(`Only ${candidates.length}/${count} clean ${domain} candidates could be generated; rejected ${rejected.length}.`);
  return candidates;
}

export function parseArgs(args) {
  const value = name => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : undefined; };
  const domain = value('domain');
  const count = Number(value('count') ?? 20);
  if (!domain) throw new TypeError('--domain is required');
  return { domain, count };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    const { domain, count } = parseArgs(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(buildDomainCandidates(domain, count), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
