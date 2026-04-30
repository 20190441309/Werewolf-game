const { test, expect } = require('@playwright/test');

test('首页加载并且规则弹窗不会重复创建', async ({ page }) => {
  await page.goto('/', { waitUntil: 'commit', timeout: 10000 });
  await expect(page).toHaveTitle(/狼人杀/);

  await page.locator('#nameInput').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('#nameInput').fill('测试玩家');
  await page.locator('button', { hasText: '确认' }).click();

  const rulesBtn = page.locator('button', { hasText: '游戏规则' }).first();
  await rulesBtn.click();

  // 等待 overlay 出现
  await page.waitForSelector('.overlay.rules-overlay');

  // 再次点击规则按钮，应该不会创建第二个 overlay
  await rulesBtn.click();

  const overlays = await page.$$('.overlay.rules-overlay');
  expect(overlays.length).toBe(1);

  // 关闭弹窗
  await page.locator('.overlay.rules-overlay button:has-text("知道了")').click();
  await expect(page.locator('.overlay.rules-overlay')).toHaveCount(0);
});
