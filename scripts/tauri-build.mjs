#!/usr/bin/env node
/**
 * Tauri 빌드 스크립트
 * - 동적 세그먼트([param])가 있는 디렉토리를 프로젝트 밖 임시 폴더로 이동
 *   단, generateStaticParams()가 이미 정의된 디렉토리는 건너뜀
 * - 정적 API route는 스텁으로 교체
 * - TAURI=true next build 실행
 * - 완료 후 원본 복원
 *
 * 데스크톱 앱의 실제 API 호출은 https://nexyfab.com/api/... 로 직접 갑니다.
 */

import './load-parent-env.mjs';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const appDir = path.join(root, 'src', 'app');
const apiDir = path.join(appDir, 'api');

// 임시 폴더: 프로젝트 밖 os.tmpdir() 하위에 생성
const tmpBase = path.join(os.tmpdir(), `nexyfab-tauri-backup-${Date.now()}`);

const STUB = `import { NextResponse } from 'next/server';
export const dynamic = 'force-static';
export async function GET() { return NextResponse.json({}, { status: 404 }); }
export async function POST() { return NextResponse.json({}, { status: 404 }); }
export async function PUT() { return NextResponse.json({}, { status: 404 }); }
export async function DELETE() { return NextResponse.json({}, { status: 404 }); }
export async function PATCH() { return NextResponse.json({}, { status: 404 }); }
`;

/** { type: 'dir'|'stub', from: original, to: tmpPath } */
const ops = [];

/** 경로에 [param] 동적 세그먼트가 포함되는지 확인 */
function hasDynamicSegment(p) {
  return p.split(path.sep).some(seg => /^\[.+\]$/.test(seg));
}

/** 디렉토리 내 파일에 generateStaticParams가 있는지 확인 */
function hasGenerateStaticParams(dir) {
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!/\.[tj]sx?$/.test(name)) continue;
      const content = fs.readFileSync(path.join(dir, name), 'utf-8');
      if (content.includes('generateStaticParams')) return true;
    }
  } catch {}
  return false;
}

/** baseDir 기준 상대 경로를 tmpBase 아래로 매핑 */
function tmpPathFor(full) {
  const rel = path.relative(appDir, full);
  return path.join(tmpBase, rel);
}

/** 디렉토리를 재귀 스캔해 ops를 수집
 * @param {string} dir - 스캔할 디렉토리
 * @param {boolean} inApi - src/app/api/ 하위 여부 (정적 route 스텁 처리)
 */
function collectOps(dir, inApi) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (/^\[.+\]$/.test(entry.name)) {
        if (hasGenerateStaticParams(full)) {
          // generateStaticParams 있으면 그냥 내부 계속 스캔 (api 스텁만)
          collectOps(full, inApi);
        } else {
          // 동적 세그먼트 디렉토리 전체 → 프로젝트 밖으로 이동
          ops.push({ type: 'dir', from: full, to: tmpPathFor(full) });
        }
      } else {
        collectOps(full, inApi || full.startsWith(apiDir));
      }
    } else if (!hasDynamicSegment(full) && /^route\.[tj]sx?$/.test(entry.name)) {
      // 모든 route 파일 (api/ 포함, auth/ 등 포함) → 스텁 교체
      // Tauri 데스크톱은 실제 API를 nexyfab.com 으로 직접 호출함
      ops.push({ type: 'stub', from: full, to: tmpPathFor(full) });
    }
  }
}

function applyOps() {
  fs.mkdirSync(tmpBase, { recursive: true });
  for (const op of ops) {
    fs.mkdirSync(path.dirname(op.to), { recursive: true });
    if (op.type === 'dir') {
      fs.renameSync(op.from, op.to);
    } else {
      // stub: 원본 tmp로 이동 후 스텁 작성
      fs.renameSync(op.from, op.to);
      fs.writeFileSync(op.from, STUB, 'utf-8');
    }
  }
  const dirs = ops.filter(o => o.type === 'dir').length;
  const stubs = ops.filter(o => o.type === 'stub').length;
  console.log(`📦 API 변환: 동적디렉토리 ${dirs}개 이동 + 스텁 ${stubs}개`);
}

function restoreOps() {
  let count = 0;
  for (const op of [...ops].reverse()) {
    if (!fs.existsSync(op.to)) continue;
    if (op.type === 'stub' && fs.existsSync(op.from)) {
      fs.unlinkSync(op.from); // 스텁 파일 삭제
    }
    // 부모 디렉토리 복원 보장
    fs.mkdirSync(path.dirname(op.from), { recursive: true });
    fs.renameSync(op.to, op.from);
    count++;
  }
  // 임시 폴더 정리
  if (fs.existsSync(tmpBase)) {
    try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch {}
  }
  if (count > 0) console.log(`✅ ${count}개 복원 완료`);
}

process.on('exit', restoreOps);
process.on('SIGINT', () => { restoreOps(); process.exit(1); });
process.on('uncaughtException', (e) => { console.error(e); restoreOps(); process.exit(1); });

// 1. .next 캐시 정리
const nextCacheDir = path.join(root, '.next');
if (fs.existsSync(nextCacheDir)) {
  console.log('🧹 .next 캐시 정리...');
  fs.rmSync(nextCacheDir, { recursive: true, force: true });
}

// 2. API 변환 적용 (src/app/ 전체 스캔)
collectOps(appDir, false);
applyOps();

try {
  // 3. Next.js 빌드
  console.log('🔨 Next.js Tauri 빌드 시작...');
  execSync('npx next build --webpack', {
    cwd: root,
    env: { ...process.env, TAURI: 'true' },
    stdio: 'inherit',
  });
  console.log('✅ Next.js 빌드 완료');
} finally {
  // 4. 항상 복원
  restoreOps();
  ops.length = 0;
}
