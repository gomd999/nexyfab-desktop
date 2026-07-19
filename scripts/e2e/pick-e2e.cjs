/* 픽킹 편집 E2E(저장소판, 260719) — 챗+스튜디오 실AI 플로우.
 * 사용: node scripts/e2e/pick-e2e.cjs [BASE]  (기본 http://localhost:3300 — 프로덕션 지정 가능)
 * 필요: 서버에 GEMINI 키(assemble/edit-part AI 콜 2회+) · playwright chromium.
 */
const BASE = (process.argv[2] || 'http://localhost:3300').replace(/\/$/, '');
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader'] });

  // ── A) 챗 면 드래그 ──
  {
    const pg = await b.newPage({ viewport: { width: 1500, height: 950 } });
    const errs = [];
    pg.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
    let fdResp = null;
    pg.on('response', async (r) => { if (r.url().includes('/face-drag/')) { try { fdResp = { status: r.status(), body: await r.json() }; } catch { fdResp = { status: r.status() }; } } });
    await pg.goto(BASE + '/kr/nexyfab/ai', { waitUntil: 'domcontentloaded' });
    await pg.waitForTimeout(2500);
    const ta = pg.locator('textarea').first();
    await ta.click();
    await ta.pressSequentially('베이스 플레이트 1000x800x20 위에 지름 200 높이 400 원통 기둥 2개를 x 200과 x 700에 세운 조립체', { delay: 3 });
    await pg.keyboard.press('Enter');
    console.log('[챗] assemble 대기…');
    let canvasOk = false;
    for (let i = 0; i < 60; i++) { await pg.waitForTimeout(2000); if (await pg.evaluate(() => document.querySelectorAll('canvas').length)) { canvasOk = true; break; } }
    console.log('[챗] canvas:', canvasOk);
    if (canvasOk) {
      await pg.waitForTimeout(3000);
      const cv = pg.locator('canvas').last();
      const box = await cv.boundingBox();
      let chip = 0;
      for (const [fx, fy] of [[0.5, 0.55], [0.45, 0.5], [0.55, 0.6], [0.5, 0.7]]) {
        await pg.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
        await pg.waitForTimeout(600);
        chip = await pg.getByText('🎯').count();
        if (chip) break;
      }
      console.log('[챗] 픽 칩:', chip > 0);
      if (chip) {
        // 선택 부품 위에서 드래그(픽 좌표 재사용) → 푸시풀
        const px0 = box.x + box.width * 0.5, py0 = box.y + box.height * 0.55;
        await pg.mouse.move(px0, py0);
        await pg.mouse.down();
        for (let s = 1; s <= 8; s++) { await pg.mouse.move(px0 + s * 10, py0 - s * 4); await pg.waitForTimeout(40); }
        await pg.mouse.up();
        for (let i = 0; i < 15 && !fdResp; i++) await pg.waitForTimeout(1000);
        console.log('[챗] face-drag 응답:', fdResp ? `${fdResp.status} ok=${fdResp.body?.ok} face=${fdResp.body?.face?.face ?? ''} err=${fdResp.body?.error ?? ''}` : '없음(제스처 미발동?)');
        if (fdResp && fdResp.status === 422) { // 방향에 따른 정직 거부(치수≤0)면 역방향 재시도
          fdResp = null;
          await pg.mouse.move(px0, py0);
          await pg.mouse.down();
          for (let s2 = 1; s2 <= 8; s2++) { await pg.mouse.move(px0 - s2 * 10, py0 + s2 * 4); await pg.waitForTimeout(40); }
          await pg.mouse.up();
          for (let i = 0; i < 15 && !fdResp; i++) await pg.waitForTimeout(1000);
          console.log('[챗] 역방향 재드래그:', fdResp ? `${fdResp.status} ok=${fdResp.body?.ok} err=${fdResp.body?.error ?? ''}` : '없음');
        }
        await pg.screenshot({ path: __dirname + '/p2_chat.png' });
      }
    }
    console.log('[챗] pageerrors:', errs.length ? errs.join('/') : 'none');
    await pg.close();
  }

  // ── B) 스튜디오 ──
  {
    const pg = await b.newPage({ viewport: { width: 1500, height: 950 } });
    const errs = [];
    pg.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
    let epResp = null, fdResp = null, asResp = null;
    pg.on('response', async (r) => {
      if (r.url().includes('/edit-part/')) { try { epResp = { status: r.status(), body: await r.json() }; } catch { epResp = { status: r.status() }; } }
      if (r.url().includes('/face-drag/')) { try { fdResp = { status: r.status(), body: await r.json() }; } catch { fdResp = { status: r.status() }; } }
      if (r.url().includes('/assemble/')) { try { asResp = { status: r.status(), body: await r.json() }; } catch { asResp = { status: r.status() }; } }
    });
    await pg.goto(BASE + '/kr/nexyfab/design', { waitUntil: 'domcontentloaded' });
    await pg.waitForTimeout(3000);
    const ta = pg.locator('textarea').first();
    await ta.click();
    await ta.fill('테이블 조립체: 상판 1600x700x30 @(0,0,500), 각재 다리 80x80x500 @(60,60,0), 다리 80x80x500 @(1460,60,0), 다리 80x80x500 @(60,560,0), 다리 80x80x500 @(1460,560,0)');
    await pg.getByRole('button', { name: /설계 생성|Generate/ }).click();
    console.log('[스튜디오] assemble 대기…');
    for (let i = 0; i < 80 && !asResp; i++) await pg.waitForTimeout(2000);
    console.log('[스튜디오] assemble:', asResp ? asResp.status + ' ok=' + (asResp.body && asResp.body.ok) + ' parts=' + (asResp.body && Array.isArray(asResp.body.parts) ? asResp.body.parts.length : '?') : '없음');
    // 도면 체크포인트 승인(§2.1) — 렌더 지연 대비 재시도
    for (let i = 0; i < 10; i++) {
      await pg.waitForTimeout(1500);
      const ap = pg.getByRole('button', { name: /승인하고 3D 적용|Approve/ });
      if (await ap.count()) { await ap.first().click(); console.log('[스튜디오] 체크포인트 승인'); break; }
    }
    await pg.waitForTimeout(11000);
    const box = await pg.evaluate(() => {
      let best = null, bestA = 0;
      for (const c of document.querySelectorAll('canvas')) {
        const r = c.getBoundingClientRect();
        if (r.width * r.height > bestA) { bestA = r.width * r.height; best = { x: r.x, y: r.y, width: r.width, height: r.height }; }
      }
      return best;
    });
    console.log('[스튜디오] canvas:', !!box, box ? Math.round(box.width) + 'x' + Math.round(box.height) : '');
    if (box) {
      let chip = 0;
      for (const [fx, fy] of [[0.5, 0.45], [0.5, 0.6], [0.42, 0.55], [0.6, 0.5], [0.5, 0.3]]) {
        await pg.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
        await pg.waitForTimeout(600);
        chip = await pg.getByText('🎯').count();
        if (chip) break;
      }
      const chipTx = chip ? await pg.locator('div:has-text("🎯")').last().innerText().catch(() => '') : '';
      console.log('[스튜디오] 픽 칩:', chip > 0, '|', chipTx.replace(/\s+/g, ' ').slice(0, 60));
      await pg.screenshot({ path: __dirname + '/p2_studio1.png' });
      if (chip) {
        await ta.fill('이 부품을 100 더 두껍게');
        await pg.getByRole('button', { name: /🎯/ }).click();
        for (let i = 0; i < 60 && !epResp; i++) await pg.waitForTimeout(1500);
        console.log('[스튜디오] edit-part:', epResp ? `${epResp.status} ok=${epResp.body?.ok}` : '없음');
        await pg.waitForTimeout(3000);
        // #2 치수 직접 입력
        const dimIn = pg.getByPlaceholder(/면 치수|dim\(mm\)/);
        if (await dimIn.count()) {
          fdResp = null;
          await dimIn.first().fill('200');
          await pg.getByRole('button', { name: /치수 적용|Set/ }).first().click();
          for (let i = 0; i < 20 && !fdResp; i++) await pg.waitForTimeout(1000);
          console.log('[스튜디오] 치수 적용(targetMm):', fdResp ? `${fdResp.status} ok=${fdResp.body?.ok}` : '없음');
          await pg.waitForTimeout(2500);
        } else console.log('[스튜디오] 치수 입력란: 없음(면 미선택?)');
        // #5 복제
        let poResp = null;
        pg.on('response', async (r) => { if (r.url().includes('/part-op/')) { try { poResp = { status: r.status(), body: await r.json() }; } catch { poResp = { status: r.status() }; } } });
        const dupBtn = pg.getByRole('button', { name: /복제|Dup/ });
        if (await dupBtn.count()) {
          await dupBtn.first().click();
          for (let i = 0; i < 20 && !poResp; i++) await pg.waitForTimeout(1000);
          console.log('[스튜디오] 복제(part-op):', poResp ? `${poResp.status} ok=${poResp.body?.ok} parts=${poResp.body && Array.isArray(poResp.body.parts) ? poResp.body.parts.length : '?'}` : '없음');
          await pg.waitForTimeout(2500);
        }
        // #1 언두
        const undoBtn = pg.getByRole('button', { name: /되돌리기|Undo/ });
        console.log('[스튜디오] 언두 버튼:', (await undoBtn.count()) > 0);
        if (await undoBtn.count()) { await undoBtn.first().click(); await pg.waitForTimeout(2500); console.log('[스튜디오] 언두 클릭 완료'); }
        await pg.screenshot({ path: __dirname + '/p2_studio2.png' });
      }
    }
    console.log('[스튜디오] pageerrors:', errs.length ? errs.join('/') : 'none');
    await pg.close();
  }
  await b.close();
})().catch((e) => { console.log('ERR', e.message); process.exit(1); });
