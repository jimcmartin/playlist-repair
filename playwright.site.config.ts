import { defineConfig, devices } from '@playwright/test';

// Runs the specs for the landing page (`*.site.spec.ts`) against its own build in dist-site/,
// served on port 4173 so it never collides with the app's 5173.
const baseURL = 'http://127.0.0.1:4173/';

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.site.spec.ts',
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL, trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build:site && npx vite preview -c vite.site.config.ts',
    url: baseURL,
    reuseExistingServer: false,
  },
});
