import { expect, test } from '@playwright/test';

const shouldRun = process.env.RUN_E2E_SMOKE === '1';

test.describe('editor smoke workflow (optional)', () => {
  test.skip(!shouldRun, 'Set RUN_E2E_SMOKE=1 to run smoke E2E tests');

  test('loads editor shell and opens chat panel', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('text=QuickCut').first()).toBeVisible();

    // Shortcut should toggle chat panel (Ctrl/Cmd + K)
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');

    await expect(page.locator('text=AI reliability telemetry').first()).toBeVisible();
  });
});
