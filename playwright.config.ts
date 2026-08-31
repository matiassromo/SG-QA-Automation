import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

dotenv.config();

export default defineConfig({
  testDir: './tests',

  fullyParallel: true,

  forbidOnly: !!process.env.CI,

  retries: process.env.CI ? 2 : 0,

  workers: process.env.CI ? 1 : undefined,

  reporter: 'html',

  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on',
  },

  projects: [
    {
      name: 'synergy-setup',
      testMatch: /.*\.auth\.setup\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.SYNERGY_BASE_URL,
      },
    },

    {
      name: 'synergy-chrome',
      testDir: './tests/ui/synergy',
      dependencies: ['synergy-setup'],
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.SYNERGY_BASE_URL,
        storageState: 'playwright/.auth/synergy.json',
      },
    },

    {
      name: 'livin-chrome',
      testDir: './tests/ui/livin',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.LIVIN_BASE_URL,
      },
    },
  ],
});
