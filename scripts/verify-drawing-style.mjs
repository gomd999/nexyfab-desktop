import { chromium } from 'playwright';
const URL = 'https://nexyfab.com/kr/shape-generator/drawing?cb=' + Math.floor(Math.random()*1e9);
const b = await chromium.launch({ channel: 'chrome', args: ['--use-gl=angle','--use-angle=swiftshader'] });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
const sum = async (attr) => {
  const els = await p.locator('[data-testid^="sheet-renderer-vp-geometry"]').all();
  let n = 0; for (const el of els) n += Number(await el.getAttribute(attr) || 0); return n;
};
try {
  await p.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForSelector('[data-testid="drawing-page-canvas"]', { timeout: 30000 });
  await p.waitForSelector('[data-testid^="sheet-renderer-vp-geometry"]', { timeout: 15000 });

  const hidden0 = await sum('data-hidden');
  const tangent0 = await sum('data-tangent');
  console.log(`initial: hidden=${hidden0} (expect >0), tangent=${tangent0} (expect 0)`);

  await p.locator('[data-testid="drawing-hidden-lines-toggle"]').click();
  const hidden1 = await sum('data-hidden');
  console.log(`after hidden-toggle OFF: hidden=${hidden1} (expect 0)`);

  await p.locator('[data-testid="drawing-tangent-edges-toggle"]').click();
  const tangent1 = await sum('data-tangent');
  console.log(`after tangent-toggle ON: tangent=${tangent1}`);

  await p.screenshot({ path: 'scripts/drawing-style-verify.png' });
  const ok = hidden0 > 0 && tangent0 === 0 && hidden1 === 0;
  console.log(ok ? '\nPASS: hidden-line toggle works on production.' : '\nFAIL');
  if (!ok) process.exit(1);
} finally { await b.close(); }
