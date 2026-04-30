const { devices } = require('@playwright/test');

/** @type {import('@playwright/test').PlaywrightTestConfig} */
module.exports = {
  timeout: 30000,
  use: {
    headless: true,
    viewport: { width: 412, height: 915 },
    actionTimeout: 10000,
    baseURL: 'http://localhost:3000',
  },
  projects: [
    { name: 'Mobile Chrome', use: { ...devices['Pixel 5'] } },
    { name: 'Mobile Safari', use: { ...devices['iPhone 12'] } },
    { name: 'Desktop Chromium', use: { viewport: { width: 1280, height: 720 } } },
  ],
  webServer: {
    command: 'node server.js',
    port: 3000,
    timeout: 120000,
    reuseExistingServer: false,
  },
  testDir: 'tests/playwright',
};
