import { expect, type Page } from '@playwright/test';

/**
 * Shape Generator E2E — 튜토리얼/웰컴 배너·쿠키 배너가 클릭을 가로막지 않도록 storage 를 미리 채운다.
 * (`useTutorial`: `nexyfab_tutorial_done` 이 있으면 웰컴 타이머가 아예 돌지 않음)
 */
export async function seedShapeGeneratorForE2e(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('nf_cookie_consent', JSON.stringify({ type: 'all', timestamp: Date.now() }));
      window.localStorage.setItem('nexyfab_tutorial_done', 'true');
      window.localStorage.setItem('nexyfab_sketch_tutorial_done', 'true');
      window.localStorage.setItem('nexyfab_visited', 'true');
    } catch {
      /* ignore */
    }
  });
}

/** 늦게 뜨는 웰컴/튜토리얼 오버레이가 있으면 닫기 시도 */
export async function dismissShapeGeneratorOverlays(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Dismiss' }).click({ timeout: 2500 }).catch(() => {});
  await page.getByRole('button', { name: 'Skip' }).click({ timeout: 2500 }).catch(() => {});
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }
}

export async function exitSketchIfNeeded(page: Page): Promise<void> {
  const exitSketch = page.getByTestId('exit-sketch');
  if (await exitSketch.isVisible().catch(() => false)) {
    await exitSketch.click({ force: true });
  } else {
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(120);
    }
  }
  await page.waitForTimeout(400);
}

/** 갤러리 박스 → Evaluate 완료까지 기다린 뒤 Auto Drawing 버튼이 활성화될 때까지 대기 */
export async function pickBoxEvaluateWaitForAutoDrawing(page: Page): Promise<void> {
  await page.getByTestId('m4-pick-box').click({ force: true, timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: 'Evaluate' }).click();
  await expect(page.getByRole('button', { name: 'Auto Drawing' })).toBeEnabled({ timeout: 120000 });
}

export async function openAutoDrawingPanel(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Auto Drawing' }).click();
  await expect(page.getByTestId('auto-drawing-panel')).toBeVisible({ timeout: 30000 });
}
