#!/usr/bin/env node
/**
 * perf-gate — N-9/T-4(260808b): 정밀 CAD 콜드 로드 성능 회귀 게이트.
 *
 * 로컬 프로덕션(스탠드얼론) 서버를 대상으로 전문가 모드 콜드 로드의
 * time-to-canvas 를 실측해 예산과 비교한다. 기준선(260808b 실측): 5.4s.
 * 예산은 기준선×3(로컬 16.2s)·CI는 변동성이 크므로 --budget-ms 로 완화 지정 —
 * 마이크로 벤치가 아니라 **파국적 회귀(수십 초대 진입)** 검출망이다.
 *
 * usage: node scripts/perf-gate.mjs <baseUrl> [--budget-ms 16200] [--runs 3]
 * exit 0=예산 내 · 1=초과 · 2=측정 실패
 */
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const BASE = args.find(a => !a.startsWith('--')) ?? 'http://localhost:3311';
const val = (name, d) => { const i = args.indexOf(`--${name}`); return i >= 0 ? Number(args[i + 1]) : d; };
const BUDGET = val('budget-ms', 16_200);
const RUNS = Math.max(1, val('runs', 3));

const browser = await chromium.launch();
const times = [];
try {
  for (let run = 0; run < RUNS; run++) {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await ctx.newPage();
    const t0 = Date.now();
    await page.goto(`${BASE}/kr/shape-generator?expert=1&mode=expert`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForSelector('canvas', { timeout: 120_000 });
    times.push(Date.now() - t0);
    await ctx.close();
  }
} catch (error) {
  console.error(`perf-gate: measurement failed — ${error instanceof Error ? error.message : String(error)}`);
  await browser.close();
  process.exit(2);
}
await browser.close();

const best = Math.min(...times); // 콜드 로드 예산은 최선값 기준(런 간 캐시·GC 노이즈 배제)
const ok = best <= BUDGET;
console.log(`time-to-canvas: runs=[${times.join(', ')}]ms best=${best}ms budget=${BUDGET}ms → ${ok ? 'PASS' : 'FAIL'}`);
process.exit(ok ? 0 : 1);
