import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { LH_SITE_BEP_REQUIREMENTS } from '../../src/lib/bim/lhSiteBepCatalog';

const execFileAsync = promisify(execFile);

const HEADING_BINDINGS: Record<string, string[]> = {
  projectOverview: ['BIM 사업개요'],
  bimGoals: ['BIM 활용목표 및 활용방안'],
  workScope: ['BIM 업무수행 범위'],
  milestones: ['주요업무 추진일정'],
  authoringScope: ['BIM 데이터 작성대상', 'BIM 데이터 작성범위 및 작성내용'],
  lodPlan: ['BIM 데이터 작성수준(LOD)'],
  modelStandards: ['BIM 적용표준', 'BIM 모델 구성체계', 'BIM 라이브러리 작성'],
  organization: ['BIM 사업수행 조직도', 'BIM 사업수행 조직표'],
  responsibilityMatrix: ['BIM 수행자의 역할 및 책임'],
  technologyEnvironment: ['BIM 수행 인프라(S/W)', 'BIM 수행 인프라(H/W)'],
  workflow: ['BIM 업무 추진절차', 'BIM 업무 협업절차'],
  cdePlan: ['공통정보관리환경(CDE) 구성 및 활용'],
  exchangeRequirements: ['파일교환 요구사항 관리', 'BIM 데이터 교환'],
  qualityPlan: ['BIM 품질검토', '품질검토 체크리스트'],
  deliverablePlan: ['BIM 성과품 납품 계획', 'BIM 성과품 목록', 'BIM 성과품 폴더체계', 'BIM 성과품 파일명 구조', '표준파일 형식'],
  securityPlan: ['데이터 보안 및 관리'],
};

async function findBepHwp(directory: string): Promise<string | null> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await findBepHwp(fullPath);
      if (nested) return nested;
    } else if (entry.name.toLowerCase().endsWith('.hwp') && /BEP|수행계획/i.test(entry.name)) return fullPath;
  }
  return null;
}

async function extractHwpText(file: string): Promise<string> {
  const python = process.env.NEXYFAB_PYTHON?.trim() || 'python';
  const { stdout } = await execFileAsync(python, ['-c', 'from hwp5.hwp5txt import main; main()', file], {
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, windowsHide: true,
  });
  return stdout.replace(/\r\n/g, '\n');
}

export async function auditBimBepSource(root: string) {
  const file = await findBepHwp(root);
  if (!file) throw new Error('BEP HWP source was not found.');
  const bytes = await readFile(file);
  const text = await extractHwpText(file);
  const requirementKeys = new Set(LH_SITE_BEP_REQUIREMENTS.map(requirement => requirement.key));
  const bindings = Object.entries(HEADING_BINDINGS).map(([key, headings]) => ({
    key,
    catalogued: requirementKeys.has(key),
    headings: headings.map(heading => ({ heading, found: text.includes(heading) })),
  }));
  const missing = bindings.flatMap(binding => binding.headings.filter(heading => !heading.found).map(heading => `${binding.key}:${heading.heading}`));
  const uncatalogued = bindings.filter(binding => !binding.catalogued).map(binding => binding.key);
  return {
    schema: 'nexyfab.bim-bep-source-audit.v1',
    generatedAt: new Date().toISOString(),
    sourcePolicy: { access: 'read_only', sourceMutation: false, extractedTextPersisted: false },
    source: {
      path: path.relative(root, file),
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      extractedTextCharacters: text.length,
      extractedTextSha256: createHash('sha256').update(text, 'utf8').digest('hex'),
      parser: 'pyhwp:hwp5txt',
    },
    catalog: { requirementCount: requirementKeys.size, bindings, missing, uncatalogued },
    status: missing.length === 0 && uncatalogued.length === 0 ? 'verified' : 'blocked',
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
  if (!root || !out) throw new Error('usage: tsx scripts/reference/audit-bim-bep-source.ts --root <directory> --out <report.json>');
  const report = await auditBimBepSource(path.resolve(root));
  await mkdir(path.dirname(path.resolve(out)), { recursive: true });
  await writeFile(path.resolve(out), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ status: report.status, source: report.source, requirementCount: report.catalog.requirementCount, missing: report.catalog.missing.length })}\n`);
}

void main();
