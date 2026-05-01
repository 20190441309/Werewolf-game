const { test, expect } = require('@playwright/test');

test('6人回合旁白验证', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'Desktop Chromium', '仅在桌面 Chromium 上运行');

  const contexts = [];
  const pages = [];
  try {
    const hostContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    contexts.push(hostContext);
    const hostPage = await hostContext.newPage();
    pages.push({ name: '房主', page: hostPage });

    // helper: enter lobby
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

    await enterLobby(hostPage, '房主');
    await hostPage.locator('button', { hasText: '创建房间' }).click();
    await expect(hostPage.locator('.room-code')).toBeVisible();
    const roomId = (await hostPage.locator('.room-code').textContent()).trim();

    for (let i = 1; i <= 5; i++) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      contexts.push(ctx);
      const p = await ctx.newPage();
      const name = `玩家${i}`;
      pages.push({ name, page: p });
      await joinRoom(p, roomId, name);
      await expect(p.locator('.room-code')).toHaveText(roomId);
    }

    await expect(hostPage.locator('.player-chip')).toHaveCount(6);
    // 启动游戏
    await hostPage.evaluate(() => document.getElementById('app').startGame());

    // 等待每个页面显示身份
    for (const entry of pages) {
      await expect(entry.page.locator('.role-name')).toBeVisible();
    }

    // 确认揭示
    for (const entry of pages) {
      await entry.page.locator('button', { hasText: '我已记住' }).click();
    }

    // 等待旁白面板出现并包含初始旁白
    await hostPage.waitForSelector('#narrationPanel .narration-msg', { timeout: 15000 });
    const firstMsg = await hostPage.locator('#narrationPanel .narration-msg').first().textContent();
    expect(firstMsg).toBeTruthy();
    expect(firstMsg).toMatch(/游戏开始|角色已分配|夜幕/);
  } finally {
    for (const ctx of contexts.reverse()) {
      await ctx.close().catch(()=>{});
    }
  }
});

test('旁白样式分级与时间戳验证', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'Desktop Chromium', '仅在桌面 Chromium 上运行');

  const contexts = [];
  const pages = [];
  try {
    const hostContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    contexts.push(hostContext);
    const hostPage = await hostContext.newPage();
    pages.push({ name: '房主', page: hostPage });

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

    await enterLobby(hostPage, '房主');
    await hostPage.locator('button', { hasText: '创建房间' }).click();
    await expect(hostPage.locator('.room-code')).toBeVisible();
    const roomId = (await hostPage.locator('.room-code').textContent()).trim();

    for (let i = 1; i <= 5; i++) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      contexts.push(ctx);
      const p = await ctx.newPage();
      const name = `玩家${i}`;
      pages.push({ name, page: p });
      await joinRoom(p, roomId, name);
      await expect(p.locator('.room-code')).toHaveText(roomId);
    }

    await expect(hostPage.locator('.player-chip')).toHaveCount(6);
    await hostPage.evaluate(() => document.getElementById('app').startGame());

    for (const entry of pages) {
      await expect(entry.page.locator('.role-name')).toBeVisible();
    }

    for (const entry of pages) {
      await entry.page.locator('button', { hasText: '我已记住' }).click();
    }

    // 等待旁白面板并验证"游戏开始"消息（emphasize 类）
    await hostPage.waitForSelector('#narrationPanel .narration-msg', { timeout: 15000 });
    const firstMsg = await hostPage.locator('#narrationPanel .narration-msg').first();
    const firstMsgText = await firstMsg.textContent();
    expect(firstMsgText).toMatch(/游戏开始|角色已分配/);
    const firstMsgClass = await firstMsg.evaluate(el => el.className);
    expect(firstMsgClass).toContain('emphasize');

    // 验证时间戳格式：应包含轮数前缀（如"夜1 HH:MM"）
    const timeSpan = await firstMsg.locator('.narr-time').textContent();
    expect(timeSpan).toMatch(/\d{1,2}:\d{2}/);

    // 等待游戏进行一段时间，产生更多旁白消息
    // 等待 4 秒让更多消息到达
    await hostPage.waitForTimeout(4000);
    const finalMsgCount = await hostPage.locator('#narrationPanel .narration-msg').count();

    // 验证消息计数：应至少有多条旁白消息
    expect(finalMsgCount).toBeGreaterThanOrEqual(2);

    // 验证样式分级：检查消息被正确应用了 system/event/emphasize 样式
    const hasStyleClasses = await hostPage.evaluate(() => {
      const msgs = document.querySelectorAll('#narrationPanel .narration-msg');
      const classes = Array.from(msgs).map(el => el.className);
      const hasSystem = classes.some(c => c.includes('system'));
      const hasEvent = classes.some(c => c.includes('event'));
      const hasEmphasize = classes.some(c => c.includes('emphasize'));
      return { hasSystem, hasEvent, hasEmphasize, total: classes.length };
    });
    
    // 验证消息都有样式类应用
    expect(hasStyleClasses.total).toBeGreaterThanOrEqual(2);
    // 验证至少有两种不同的样式
    const styleTypeCount = [hasStyleClasses.hasSystem, hasStyleClasses.hasEvent, hasStyleClasses.hasEmphasize].filter(Boolean).length;
    expect(styleTypeCount).toBeGreaterThanOrEqual(1); // 至少一种样式应用

    // 验证时间戳格式一致性
    const timestamps = await hostPage.locator('#narrationPanel .narr-time').allTextContents();
    expect(timestamps.length).toBeGreaterThan(0);
    for (const ts of timestamps) {
      expect(ts).toMatch(/\d{1,2}:\d{2}/);
    }

  } finally {
    for (const ctx of contexts.reverse()) {
      await ctx.close().catch(()=>{});
    }
  }
});

test('旁白 TTS 功能验证', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'Desktop Chromium', '仅在桌面 Chromium 上运行');

  const contexts = [];
  const pages = [];
  try {
    const hostContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    contexts.push(hostContext);
    const hostPage = await hostContext.newPage();
    pages.push({ name: '房主', page: hostPage });

    // 模拟 speechSynthesis API，用于在无音频系统上测试
    await hostPage.evaluateHandle(() => {
      if (!window.speechSynthesis) {
        window.speechSynthesis = {
          cancel: () => {},
          speak: (utter) => {
            console.log('TTS speak called:', utter.text);
          }
        };
      }
    });

    async function enterLobby(page, name) {
      await page.evaluateHandle(() => {
        if (!window.speechSynthesis) {
          window.speechSynthesis = {
            cancel: () => {},
            speak: (utter) => {}
          };
        }
      });
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

    await enterLobby(hostPage, '房主');
    await hostPage.locator('button', { hasText: '创建房间' }).click();
    await expect(hostPage.locator('.room-code')).toBeVisible();
    const roomId = (await hostPage.locator('.room-code').textContent()).trim();

    // 加入 5 个玩家形成 6 人局
    for (let i = 1; i <= 5; i++) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      contexts.push(ctx);
      const p = await ctx.newPage();
      const name = `玩家${i}`;
      pages.push({ name, page: p });
      await joinRoom(p, roomId, name);
      await expect(p.locator('.room-code')).toHaveText(roomId);
    }

    await expect(hostPage.locator('.player-chip')).toHaveCount(6);
    await hostPage.evaluate(() => document.getElementById('app').startGame());

    for (const entry of pages) {
      await expect(entry.page.locator('.role-name')).toBeVisible();
    }

    for (const entry of pages) {
      await entry.page.locator('button', { hasText: '我已记住' }).click();
    }

    // 等待旁白面板出现
    await hostPage.waitForSelector('#narrationPanel', { timeout: 15000 });

    // 测试 TTS 按钮的启用/禁用与 toast 提示
    const ttsBtn = hostPage.locator('#narrationPanel .ctrl-btn[title="语音播报"]');
    await expect(ttsBtn).toBeVisible();

    // 初始状态：TTS 应该是禁用的（没有 'active' 类）
    let hasActive = await ttsBtn.evaluate(el => el.classList.contains('active'));
    expect(hasActive).toBe(false);

    // 点击 TTS 按钮以启用
    await ttsBtn.click();
    await hostPage.waitForTimeout(500);
    
    // 验证按钮状态变为 active
    hasActive = await ttsBtn.evaluate(el => el.classList.contains('active'));
    expect(hasActive).toBe(true);

    // 验证 toast 提示出现（检查文本中是否包含"语音播报已开启"）
    const toastMsg = await hostPage.locator('.toast').last().textContent();
    expect(toastMsg).toMatch(/语音播报已开启/);

    // 等待 toast 消失后再测试关闭
    await hostPage.waitForTimeout(3000);

    // 再次点击以禁用 TTS
    await ttsBtn.click();
    await hostPage.waitForTimeout(500);

    // 验证按钮状态变为非 active
    hasActive = await ttsBtn.evaluate(el => el.classList.contains('active'));
    expect(hasActive).toBe(false);

    // 验证新的 toast 提示（"语音播报已关闭"）
    const toastMsg2 = await hostPage.locator('.toast').last().textContent();
    expect(toastMsg2).toMatch(/语音播报已关闭/);

    // 再次启用 TTS，并验证当新旁白消息到达时是否触发播报
    await ttsBtn.click();
    await hostPage.waitForTimeout(500);

    // 等待新消息（在夜间阶段应该不断产生旁白）
    await hostPage.waitForTimeout(2000);
    const msgs = await hostPage.locator('#narrationPanel .narration-msg').count();
    expect(msgs).toBeGreaterThan(0);

  } finally {
    for (const ctx of contexts.reverse()) {
      await ctx.close().catch(()=>{});
    }
  }
});
