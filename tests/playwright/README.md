# Playwright E2E 测试指南

本项目使用 **Playwright** 作为 E2E 测试框架，涵盖桌面与移动端网页测试。

## 📦 快速开始

### 1. 安装依赖与 Playwright 浏览器

建议使用 Node.js 22.x 运行本套测试，和当前 CI 配置保持一致。

```bash
cd three
npm install
npm run prepare:e2e
```

- `npm install` 会安装所有依赖，包括 `@playwright/test`
- `npm run prepare:e2e` 会下载 Playwright 所需的浏览器二进制（Chromium、Firefox、WebKit）

### 2. 本地运行测试

```bash
npm run test:e2e
```

Playwright 会自动：
1. 启动本地 Node.js 服务器（监听 `http://localhost:3000`）
2. 在多个浏览器配置中运行测试（Mobile Chrome、Mobile Safari、Desktop Chromium）
3. 生成测试报告到 `playwright-report/` 目录
4. 在测试完成后停止服务器

### 3. 查看测试报告

测试运行完成后，使用以下命令打开交互式测试报告：

```bash
npx playwright show-report
```

报告展示：
- ✅ 通过的测试
- ❌ 失败的测试（含错误堆栈）
- 📸 截图与视频（如启用）
- ⏱️ 执行时间

## 🧪 测试结构

### 文件组织

```
three/
├── tests/
│   └── playwright/
│       ├── e2e.spec.js           # 基础规则弹窗测试
│       └── functional.spec.js     # 扩展功能测试（房间、UI、移动端）
├── playwright.config.js            # Playwright 配置
└── package.json                    # 脚本与依赖声明
```

### 测试覆盖范围

| 文件 | 覆盖的测试用例 | 优先级 |
|------|--------------|--------|
| `e2e.spec.js` | TC-16.x (规则弹窗) | P0 |
| `functional.spec.js` | TC-1.x, TC-16.x, TC-M1~M3, TC-4.1 | P0~P1 |

## 🚀 GitHub Actions CI 工作流

当你 push 或创建 PR 时，自动运行以下工作流程：

### 工作流文件
`.github/workflows/e2e.yml`

### 工作流步骤
1. **Checkout** - 拉取代码
2. **Setup Node.js** - 安装 Node.js (支持 16.x 和 18.x 两个版本)
3. **npm ci** - 安装依赖（使用 lockfile，确保版本一致）
4. **准备 Playwright** - 下载浏览器二进制
5. **运行测试** - 执行所有 `.spec.js` 测试
6. **上传报告** - 保存测试报告和截图（30天过期）

### 触发条件

- 当向 `main`、`master`、`develop` 分支 **push** 时
- 当向上述分支创建 **pull request** 时

### 查看 CI 结果

1. 打开你的 GitHub 仓库
2. 点击 **Actions** 标签
3. 选择最近的工作流运行
4. 查看日志与下载 artifacts：
   - `playwright-report-{node-version}` - HTML 格式的测试报告
   - `blob-reports-{node-version}` - 二进制报告（用于与主报告合并）

## 📝 添加新的测试

### 基础结构

```javascript
const { test, expect } = require('@playwright/test');

test('描述你的测试', async ({ page }) => {
  // 1. 导航
  await page.goto('/');
  
  // 2. 执行操作
  await page.click('button');
  
  // 3. 验证
  await expect(page.locator('text=成功')).toBeVisible();
});
```

### 移动端特定测试

```javascript
test.use({ viewport: { width: 375, height: 667 } });
test('移动端测试', async ({ page }) => {
  // 这个测试将在 375x667 的视口中运行
  await page.goto('/');
});
```

### 带有多个浏览器的测试

```javascript
test.describe('跨浏览器测试', () => {
  test('在所有配置中运行', async ({ page }) => {
    await page.goto('/');
  });
});
// 会自动在 Mobile Chrome、Mobile Safari、Desktop Chromium 中运行
```

## ⚙️ Playwright 配置详解

`playwright.config.js` 中的关键配置：

```javascript
{
  timeout: 30000,                    // 单个测试超时 30 秒
  use: {
    headless: true,                  // 无头模式运行（CI 中推荐）
    viewport: { width: 412, height: 915 }, // 默认移动视口
    baseURL: 'http://localhost:3000' // 基础 URL
  },
  projects: [
    { name: 'Mobile Chrome', use: { ...devices['Pixel 5'] } },
    { name: 'Mobile Safari', use: { ...devices['iPhone 12'] } },
    { name: 'Desktop Chromium', use: { viewport: { width: 1280, height: 720 } } }
  ],
  webServer: {
    command: 'node server.js',
    port: 3000,
    timeout: 120000,
    reuseExistingServer: false       // CI 中始终重新启动
  }
}
```

## 🐛 故障排查

### 问题：测试超时
```
Timeout exceeded in test
```
**解决方案：**
- 增加 `timeout` 值
- 检查网络速度或服务器响应
- 确保服务器在测试前已启动

### 问题：找不到元素
```
Locator.click: Target page, context or browser has been closed
```
**解决方案：**
- 使用 `page.waitForSelector()` 等待元素加载
- 检查选择器是否正确（使用 Playwright Inspector）

### 问题：CI 中测试通过，本地失败
**解决方案：**
- 确保本地 Node.js 版本与 CI 一致
- 清除 `.playwright` 缓存：`rm -rf ~/.cache/ms-playwright`
- 重新安装：`npm run prepare:e2e`

## 🔧 调试

### 打开 Playwright Inspector

```bash
npx playwright test --debug
```

这会打开一个交互式调试器，可以逐步执行测试。

### 以 UI 模式运行

```bash
npx playwright test --ui
```

在浏览器中实时查看测试执行。

### 保存截图和视频

修改 `playwright.config.js`：

```javascript
use: {
  screenshot: 'only-on-failure', // 仅在失败时保存截图
  video: 'retain-on-failure',    // 仅在失败时保存视频
}
```

## 📚 相关文档

- [Playwright 官方文档](https://playwright.dev)
- [TEST_PLAN.md](../TEST_PLAN.md) - 完整测试计划（覆盖 100+ 用例）
- [package.json](../package.json) - 项目依赖与脚本

## 🎯 下一步

1. **本地验证** - 运行 `npm run test:e2e` 确保所有测试通过
2. **扩展测试** - 根据 `TEST_PLAN.md` 中的 P0/P1 用例补充更多测试
3. **CI 配置** - 推送至 GitHub，观察 Actions 工作流运行结果
4. **性能基准** - 可选：添加性能测试（Lighthouse、Artillery 等）

---

**最后更新**: 2026年4月30日  
**维护者**: QA Team
