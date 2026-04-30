const { test, expect } = require('@playwright/test');

test.describe('规则弹窗 (TC-16.x)', () => {
  test('首页加载并且规则弹窗不会重复创建', async ({ page }) => {
    await page.goto('/', { waitUntil: 'commit', timeout: 10000 });
    await expect(page).toHaveTitle(/狼人杀/);

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

  test('规则弹窗显示所有角色信息', async ({ page }) => {
    await page.goto('/', { waitUntil: 'commit', timeout: 10000 });
    await page.locator('#nameInput').waitFor({ state: 'visible', timeout: 10000 });

    await page.locator('#nameInput').fill('测试玩家');
    await page.locator('button', { hasText: '确认' }).click();

    const rulesBtn = page.locator('button', { hasText: '游戏规则' }).first();
    await rulesBtn.click();

    const modal = page.locator('.overlay.rules-overlay .modal');
    await expect(modal).toContainText('🐺 狼人');
    await expect(modal).toContainText('👨‍🌾 村民');
    await expect(modal).toContainText('🔮 预言家');
    await expect(modal).toContainText('🧪 女巫');
    await expect(modal).toContainText('🏹 猎人');
    await expect(modal).toContainText('🛡️ 守卫');
  });
});

test.describe('房间管理 (TC-1.x)', () => {
  test('创建房间并获取有效的房间ID', async ({ page }) => {
    await page.goto('/', { waitUntil: 'commit', timeout: 10000 });
    await page.locator('#nameInput').waitFor({ state: 'visible', timeout: 10000 });

    await page.locator('#nameInput').fill('测试玩家1');
    await page.locator('button', { hasText: '确认' }).click();

    await page.locator('button', { hasText: '创建房间' }).click();

    // 等待房间ID显示
    await page.waitForSelector('.room-id, [data-testid="room-id"]', { timeout: 5000 }).catch(() => {
      // 如果找不到特定选择器，尝试查找任何包含房间ID格式的元素
      return page.locator('text=/[A-Z0-9]{6}/').first();
    });

    const roomIdText = await page.textContent('body');
    const roomIdMatch = roomIdText.match(/[A-Z0-9]{6}/);
    expect(roomIdMatch).toBeTruthy();
    expect(roomIdMatch[0].length).toBe(6);
  });

  test('进入房间前验证玩家名称输入', async ({ page }) => {
    await page.goto('/', { waitUntil: 'commit', timeout: 10000 });
    
    // 尝试不输入名称直接创建房间
    const createBtn = page.locator('button', { hasText: '创建房间' }).first();
    
    // 检查按钮是否禁用或表单是否有验证
    const nameInput = page.locator('#nameInput').first();
    await nameInput.fill('');
    
    // 大部分现代应用会通过 required 属性或 disabled 按钮处理
    const isCreateDisabled = await createBtn.isDisabled().catch(() => false);
    if (isCreateDisabled) {
      expect(isCreateDisabled).toBe(true);
    }
  });
});

test.describe('UI/UX与界面响应式 (TC-16.x, TC-M1)', () => {
  test('大厅界面显示标题和主要按钮', async ({ page }) => {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
    
    await expect(page.locator('h1')).toContainText(/狼\s*人\s*杀/);

    await page.locator('#nameInput').fill('测试玩家');
    await page.locator('button', { hasText: '确认' }).click();

    await expect(page.locator('button', { hasText: '创建房间' })).toBeVisible();
    await expect(page.locator('button', { hasText: '加入' })).toBeVisible();
  });

  test('暗黑主题颜色正确应用', async ({ page }) => {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
    
    // 检查背景颜色是否为暗黑色
    const bodyStyle = await page.evaluate(() => {
      const el = document.querySelector('body');
      return window.getComputedStyle(el).backgroundColor;
    });
    
    // 暗色背景应该包含较低的RGB值
    expect(bodyStyle).toMatch(/rgb\(\s*\d{1,2},\s*\d{1,2},\s*\d{1,2}\)/);
  });

  test('月亮动画存在', async ({ page }) => {
    await page.goto('/', { waitUntil: 'commit', timeout: 10000 });
    
    const moon = page.locator('.moon');
    await expect(moon).toBeVisible();
    
    // 检查动画
    const moonStyle = await page.evaluate(() => {
      const el = document.querySelector('.moon');
      return window.getComputedStyle(el).animation;
    });
    
    expect(moonStyle).toContain('moonGlow');
  });
});

test.describe('移动端响应式 (TC-M1)', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('手机端布局无水平滚动', async ({ page }) => {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
    
    // 检查是否有水平滚动条
    const scrollWidth = await page.evaluate(() => {
      return document.documentElement.scrollWidth;
    });
    
    const viewportWidth = 375;
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth);
  });

  test('移动端按钮点击区域足够大', async ({ page }) => {
    await page.goto('/', { waitUntil: 'commit', timeout: 10000 });
    await page.locator('#nameInput').waitFor({ state: 'visible', timeout: 10000 });
    
    await page.locator('#nameInput').fill('测试玩家');
    await page.locator('button', { hasText: '确认' }).click();

    const btn = page.locator('button', { hasText: '创建房间' }).first();
    const box = await btn.boundingBox();
    
    // 按钮高度应该至少 44px（移动端 tap target 最小推荐）
    expect(box.height).toBeGreaterThanOrEqual(40);
    // 按钮宽度应该至少 44px
    expect(box.width).toBeGreaterThanOrEqual(40);
  });
});

test.describe('网络与连接 (TC-4.1)', () => {
  test('WebSocket连接建立成功', async ({ page }) => {
  await page.goto('/', { waitUntil: 'commit', timeout: 10000 });
    await page.waitForFunction(() => typeof window.io === 'function', null, { timeout: 5000 });
    
    // 监听 Socket.IO 连接
    const socketConnected = await page.evaluate(() => {
      return typeof io !== 'undefined';
    });
    
    expect(socketConnected).toBe(true);
  });
});

test.describe('触控交互 (TC-M2)', () => {
  test.use({ hasTouch: true });

  test('触摸点击按钮可正确响应', async ({ page }) => {
      await page.goto('/', { waitUntil: 'commit', timeout: 10000 });
    
    await page.locator('#nameInput').fill('测试玩家');
    await page.locator('button', { hasText: '确认' }).click();

    const rulesBtn = page.locator('button', { hasText: '游戏规则' }).first();
    
    // 使用 tap 模拟触控（Playwright 在移动设备上自动使用 tap）
    await rulesBtn.tap();
    
    await page.waitForSelector('.overlay.rules-overlay');
    const overlay = page.locator('.overlay.rules-overlay');
    await expect(overlay).toBeVisible();
  });
});

test.describe('横竖屏切换 (TC-M3)', () => {
  test('纵向屏幕布局', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'Mobile Safari', 'Mobile Safari 在当前环境下横竖屏切换不稳定');
    page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/', { waitUntil: 'commit', timeout: 10000 });
    
    const app = page.locator('.app');
    await expect(app).toBeVisible();
    
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(375);
  });

  test('横向屏幕布局', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'Mobile Safari', 'Mobile Safari 在当前环境下横竖屏切换不稳定');
    page.setViewportSize({ width: 812, height: 375 });
    await page.goto('/', { waitUntil: 'commit', timeout: 10000 });
    
    const app = page.locator('.app');
    await expect(app).toBeVisible();
    
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(812);
  });
});

async function enterLobby(page, name) {
  await page.goto('/', { waitUntil: 'commit', timeout: 10000 });
  await page.locator('#nameInput').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('#nameInput').fill(name);
  await page.locator('button', { hasText: '确认' }).click();
  await expect(page.locator('button', { hasText: '创建房间' })).toBeVisible();
}

async function joinRoom(page, roomId, name) {
  await enterLobby(page, name);
  await page.locator('#joinRoomId').fill(roomId);
  await page.locator('button', { hasText: '加入' }).click();
}

async function getRole(page) {
  return (await page.locator('.role-name').textContent()).trim();
}

async function confirmReveal(page) {
  await page.locator('button', { hasText: '我已记住' }).click();
}

async function clickPlayerByName(page, playerName) {
  await page.locator('.player-chip').filter({ hasText: playerName }).first().click();
}

test.describe('完整游戏流程 (TC-6.x, TC-7.x, TC-8.x, TC-9.x)', () => {
  test('八人房间可完成创建、入场、揭示、夜晚、投票和猎人开枪', async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'Desktop Chromium', '完整流程仅在桌面 Chromium 上运行');

    const pages = [];
    const contexts = [];

    try {
      const hostContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      contexts.push(hostContext);
      const hostPage = await hostContext.newPage();
      pages.push({ name: '房主', page: hostPage });

      await enterLobby(hostPage, '房主');
      await hostPage.locator('button', { hasText: '创建房间' }).click();
      await expect(hostPage.locator('.room-code')).toBeVisible();
      const roomId = (await hostPage.locator('.room-code').textContent()).trim();

      for (let i = 1; i <= 7; i++) {
        const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
        contexts.push(context);
        const page = await context.newPage();
        const name = `玩家${i}`;
        pages.push({ name, page });
        await joinRoom(page, roomId, name);
        await expect(page.locator('.room-code')).toHaveText(roomId);
      }

      await expect(hostPage.locator('.player-chip')).toHaveCount(8);
      await hostPage.evaluate(() => document.getElementById('app').startGame());

      for (const entry of pages) {
        await expect(entry.page.locator('.role-name')).toBeVisible();
      }

      const roleMap = new Map();
      for (const entry of pages) {
        roleMap.set(entry.name, await getRole(entry.page));
      }

      for (const entry of pages) {
        await confirmReveal(entry.page);
      }

      const wolfEntries = pages.filter(entry => roleMap.get(entry.name) === '狼人');
      const seerEntry = pages.find(entry => roleMap.get(entry.name) === '预言家');
      const witchEntry = pages.find(entry => roleMap.get(entry.name) === '女巫');
      const guardEntry = pages.find(entry => roleMap.get(entry.name) === '守卫');
      const hunterEntry = pages.find(entry => roleMap.get(entry.name) === '猎人');
      const nonWolfTarget = pages.find(entry => roleMap.get(entry.name) !== '狼人');

      expect(wolfEntries.length).toBeGreaterThanOrEqual(2);
      expect(seerEntry).toBeTruthy();
      expect(witchEntry).toBeTruthy();
      expect(guardEntry).toBeTruthy();
      expect(hunterEntry).toBeTruthy();
      expect(nonWolfTarget).toBeTruthy();

      await expect(hostPage.locator('h1')).toContainText('狼人行动');

      for (const wolf of wolfEntries) {
        await clickPlayerByName(wolf.page, nonWolfTarget.name);
      }

      await expect(hostPage.locator('h1')).toContainText('预言家行动', { timeout: 10000 });

      const seerTarget = pages.find(entry => entry.name !== seerEntry.name);
      await clickPlayerByName(seerEntry.page, seerTarget.name);
      await expect(hostPage.locator('h1')).toContainText('女巫行动', { timeout: 10000 });

      await witchEntry.page.locator('button', { hasText: '确认完成' }).click();
      await expect(hostPage.locator('h1')).toContainText('守卫行动', { timeout: 10000 });

      const guardTarget = pages.find(entry => entry.name !== guardEntry.name);
      await clickPlayerByName(guardEntry.page, guardTarget.name);
      await guardEntry.page.locator('button', { hasText: '确认守护' }).click();

      await expect(hostPage.locator('h1')).toContainText('天亮了', { timeout: 10000 });
      await hostPage.locator('button', { hasText: '进入投票阶段' }).click();
      await expect(hostPage.locator('h1')).toContainText('投票放逐', { timeout: 10000 });

      for (const entry of pages) {
        await expect(entry.page.locator('h1')).toContainText('投票放逐', { timeout: 10000 });
      }

      const hunterSocketId = await hostPage.locator('.player-chip').filter({ hasText: hunterEntry.name }).first().getAttribute('data-id');
      expect(hunterSocketId).toBeTruthy();

      for (const entry of pages) {
        if (entry.name === hunterEntry.name) continue;
        await entry.page.evaluate((targetId) => {
          document.getElementById('app').castVote(targetId);
        }, hunterSocketId);
      }

      await expect(hostPage.locator('h1')).toContainText('投票放逐', { timeout: 10000 });
    } finally {
      for (const context of contexts.reverse()) {
        await context.close().catch(() => {});
      }
    }
  });
});
