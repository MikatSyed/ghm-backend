import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './',
  testMatch: /.*\.spec\.ts$/,
  timeout: 10 * 60 * 1000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:6397/api/v1/',
    extraHTTPHeaders: {
      'Content-Type': 'application/json',
    },
  },
});
