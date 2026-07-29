/**
 * importMerge.ts — 혼합 어셈블리 리졸버(Phase5, 260718): 실물 STEP 부품 삽입.
 *
 * parts 의 `{ id, type:'import', file, at:{tx,ty,tz} }` 를 게이트용 box(부품 전수
 * AABB — stepToNexyfabAssembly 의 솔리드 경계, revolve 포함 정확)로 환산하고,
 * to-step 병합용 imports[{file, offset}] 를 산출한다. 형상은 병합 단계에서 원본
 * STEP 그대로(무손실) — 여기 box 는 간섭·부유 게이트 전용(STEP 임포터 규약 동일).
 *
 * ⚠라이선스 게이트: 참고 코퍼스(GrabCAD 로컬 전용) 경로 삽입 거부 — 산출물에 타인
 * 기하 재배포 금지. 사용자 소유/자체 생성 STEP 만 허용.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const CORPUS_BLOCK = [/참고파일들/, /grabcad/i];

interface ImportPartSpec {
  id: string;
  type: 'import';
  file: string;
  at?: { tx?: number; ty?: number; tz?: number };
  role?: string;
  material?: string;
}

export interface ResolvedImports {
  asm: { parts: unknown[] } & Record<string, unknown>;
  imports: Array<{ id: string; file: string; offset: [number, number, number] }>;
  errors: string[];
}

type StepBounds = { min: number[]; max: number[]; basis?: string; occtInflatePct?: number[]; note?: string };
type ToStepMod = { stepFileBounds: (file: string) => Promise<StepBounds> };
let _ts: ToStepMod | null = null;
async function loadToStep(): Promise<ToStepMod> {
  if (_ts) return _ts;
  const p = join(process.cwd(), 'scripts', 'drawing-to-3d', 'to-step.mjs');
  _ts = (await import(/* webpackIgnore: true */ pathToFileURL(p).href)) as ToStepMod;
  return _ts;
}

export async function resolveImportParts(asm: { parts?: unknown[] } & Record<string, unknown>): Promise<ResolvedImports> {
  const ts = await loadToStep();
  const errors: string[] = [];
  const imports: ResolvedImports['imports'] = [];
  const parts: unknown[] = [];
  for (const p of (asm.parts ?? []) as Array<Record<string, unknown>>) {
    if (p.type !== 'import') { parts.push(p); continue; }
    const sp = p as unknown as ImportPartSpec;
    if (typeof sp.file !== 'string' || !sp.file) { errors.push(`${sp.id}: import file 필요`); continue; }
    if (CORPUS_BLOCK.some((re) => re.test(sp.file))) {
      errors.push(`${sp.id}: 참고 코퍼스 파일은 산출물에 삽입 불가(로컬 전용 라이선스) — 사용자 소유 STEP 만 허용`);
      continue;
    }
    let text: string;
    try { text = readFileSync(sp.file, 'latin1'); } catch { errors.push(`${sp.id}: 파일 읽기 실패(${sp.file})`); continue; }
    if (!text.includes('ISO-10303')) { errors.push(`${sp.id}: STEP 형식 아님`); continue; }
    let b: StepBounds | null = null;
    try { b = await ts.stepFileBounds(sp.file); } catch (e) { errors.push(`${sp.id}: OCCT 경계 실패(${String(e instanceof Error ? e.message : e).slice(0, 60)})`); continue; }
    if (!b) { errors.push(`${sp.id}: 경계 없음`); continue; }
    const at = { tx: sp.at?.tx ?? 0, ty: sp.at?.ty ?? 0, tz: sp.at?.tz ?? 0 };
    imports.push({ id: sp.id, file: sp.file, offset: [at.tx - b.min[0], at.ty - b.min[1], at.tz - b.min[2]] });
    parts.push({
      id: sp.id, type: 'box',
      params: {
        width: +(b.max[0] - b.min[0]).toFixed(1),
        depth: +(b.max[1] - b.min[1]).toFixed(1),
        height: +(b.max[2] - b.min[2]).toFixed(1),
      },
      at,
      role: sp.role ?? 'imported', material: sp.material ?? 'steel',
      // ⚠ `importedApprox` 는 「형상이 박스 근사」를 뜻하지 「경계가 부정확」을 뜻하지 않는다.
      // 260729: 경계 자체가 최대 46% 부풀어 있었다(OCCT Bnd_Box) — stepFileBounds 가
      // 테셀레이션 실측으로 바뀌면서 해소. 근거를 부품에 그대로 옮겨 추적 가능하게 둔다.
      importedApprox: true, _importFile: sp.file,
      ...(b.basis ? { _boundsBasis: b.basis } : {}),
      ...(b.note ? { _boundsNote: b.note } : {}),
    });
  }
  return { asm: { ...asm, parts }, imports, errors };
}
