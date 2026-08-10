#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { chromium, devices } from '@playwright/test';

const baseUrl = (process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3337').replace(/\/$/, '');
const outputArg = process.argv.indexOf('--out');
const outputPath = outputArg >= 0 ? process.argv[outputArg + 1] : null;

const scenarios = [
  {
    id: 'landing-desktop', pathname: '/kr/', device: 'Desktop Chrome', settleMs: 2_000,
    budget: { transferBytes: 734_003, decodedBodyBytes: 2_600_000 },
  },
  {
    id: 'guided-design-desktop', pathname: '/kr/nexyfab/design/', device: 'Desktop Chrome', settleMs: 3_000,
    budget: { transferBytes: 943_718, decodedBodyBytes: 3_145_728 },
  },
  {
    id: 'precision-cad-mobile', pathname: '/kr/shape-generator/?expert=1', device: 'Pixel 5', settleMs: 5_000,
    budget: { transferBytes: 2_621_440, decodedBodyBytes: 6_500_000 },
  },
  {
    id: 'precision-cad-desktop', pathname: '/kr/shape-generator/?expert=1', device: 'Desktop Chrome', settleMs: 6_000,
    budget: { transferBytes: 7_340_032, decodedBodyBytes: 21_000_000 },
  },
];

function contextOptions(deviceName) {
  const options = { ...devices[deviceName] };
  delete options.defaultBrowserType;
  return options;
}

async function auditScenario(browser, scenario) {
  const context = await browser.newContext(contextOptions(scenario.device));
  const page = await context.newPage();
  const requestedUrls = [];
  const failedRequests = [];
  const consoleErrors = [];
  const pageErrors = [];
  page.on('request', request => requestedUrls.push(request.url()));
  page.on('requestfailed', request => failedRequests.push({
    url: request.url(),
    error: request.failure()?.errorText ?? 'unknown',
  }));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));

  const startedAt = Date.now();
  const response = await page.goto(`${baseUrl}${scenario.pathname}`, {
    waitUntil: 'domcontentloaded',
    timeout: 90_000,
  });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(scenario.settleMs);

  const browserMetrics = await page.evaluate(() => {
    const entries = performance.getEntriesByType('resource');
    const navigation = performance.getEntriesByType('navigation')[0];
    const all = navigation ? [navigation, ...entries] : entries;
    const sum = key => all.reduce((total, entry) => total + (Number(entry[key]) || 0), 0);
    const scriptEntries = entries.filter(entry => entry.initiatorType === 'script');
    const scriptSum = key => scriptEntries.reduce((total, entry) => total + (Number(entry[key]) || 0), 0);
    const memory = performance.memory;
    const occtButton = [...document.querySelectorAll('button')].find(element => element.textContent?.includes('OCCT:'));
    const topResources = entries
      .map(entry => ({
        url: entry.name,
        initiatorType: entry.initiatorType,
        transferBytes: Number(entry.transferSize) || 0,
        decodedBodyBytes: Number(entry.decodedBodySize) || 0,
      }))
      .sort((left, right) => right.transferBytes - left.transferBytes)
      .slice(0, 30);
    return {
      resourceCount: all.length,
      transferBytes: sum('transferSize'),
      encodedBodyBytes: sum('encodedBodySize'),
      decodedBodyBytes: sum('decodedBodySize'),
      scriptTransferBytes: scriptSum('transferSize'),
      scriptDecodedBodyBytes: scriptSum('decodedBodySize'),
      domContentLoadedMs: navigation?.domContentLoadedEventEnd ?? null,
      loadEventMs: navigation?.loadEventEnd ?? null,
      jsHeapBytes: memory?.usedJSHeapSize ?? null,
      occtStatus: occtButton ? { text: occtButton.textContent, title: occtButton.getAttribute('title'), disabled: occtButton.hasAttribute('disabled'), preference: localStorage.getItem('nf_occt_pref') } : null,
      topResources,
    };
  });

  const finalUrl = page.url();
  const status = response?.status() ?? null;
  const headers = response?.headers() ?? {};
  await context.close();

  const recaptchaRequests = requestedUrls.filter(url => /google\.com\/recaptcha|gstatic\.com\/recaptcha/i.test(url));
  const wasmRequests = requestedUrls.filter(url => /\.wasm(?:\?|$)/i.test(url));
  const exactKernelRequests = requestedUrls.filter(url => /replicad_single\.wasm|occt-import-js\.wasm|opencascade\.wasm/i.test(url));

  return {
    id: scenario.id,
    requestedPath: scenario.pathname,
    finalUrl,
    status,
    elapsedMs: Date.now() - startedAt,
    headers: {
      contentSecurityPolicy: headers['content-security-policy'] ?? null,
      xContentTypeOptions: headers['x-content-type-options'] ?? null,
      referrerPolicy: headers['referrer-policy'] ?? null,
    },
    ...browserMetrics,
    budget: scenario.budget,
    recaptchaRequests,
    wasmRequests,
    exactKernelRequests,
    failedRequests,
    consoleErrors,
    pageErrors,
  };
}

function evaluateChecks(results) {
  const byId = Object.fromEntries(results.map(result => [result.id, result]));
  return [
    ...results.map(result => ({
      id: `${result.id}.http`,
      pass: typeof result.status === 'number' && result.status >= 200 && result.status < 400,
      actual: result.status,
    })),
    ...results.map(result => ({
      id: `${result.id}.csp`,
      pass: Boolean(result.headers.contentSecurityPolicy),
      actual: result.headers.contentSecurityPolicy ? 'present' : 'missing',
    })),
    ...results.flatMap(result => Object.entries(result.budget).map(([metric, limit]) => ({
      id: `${result.id}.${metric}-budget`,
      pass: result[metric] <= limit,
      actual: result[metric],
      limit,
    }))),
    {
      id: 'landing-desktop.recaptcha-lazy',
      pass: byId['landing-desktop'].recaptchaRequests.length === 0,
      actual: byId['landing-desktop'].recaptchaRequests,
    },
    {
      id: 'guided-design-desktop.recaptcha-lazy',
      pass: byId['guided-design-desktop'].recaptchaRequests.length === 0,
      actual: byId['guided-design-desktop'].recaptchaRequests,
    },
    {
      id: 'precision-cad-mobile.exact-kernel-on-demand',
      pass: byId['precision-cad-mobile'].exactKernelRequests.length === 0,
      actual: byId['precision-cad-mobile'].exactKernelRequests,
    },
    {
      id: 'precision-cad-desktop.exact-kernel-default',
      pass: byId['precision-cad-desktop'].exactKernelRequests.length > 0,
      actual: byId['precision-cad-desktop'].exactKernelRequests,
    },
  ];
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-dev-shm-usage',
      '--enable-precise-memory-info',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
    ],
  });
  let results;
  try {
    results = [];
    for (const scenario of scenarios) results.push(await auditScenario(browser, scenario));
  } finally {
    await browser.close();
  }

  const checks = evaluateChecks(results);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    baseUrl,
    pass: checks.every(check => check.pass),
    checks,
    results,
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) {
    const resolved = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, serialized);
    process.stdout.write(`Runtime performance report: ${resolved}\n`);
  } else {
    process.stdout.write(serialized);
  }
  if (!report.pass) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
