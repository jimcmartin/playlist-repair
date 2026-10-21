import { defineConfig, devices } from '@playwright/test';

// Runs the specs that need the production build, which carries the Content
// Security Policy. The app only accepts http://127.0.0.1:5173/, so the build is
// served on the dev server's port, and a dev server already running there must
// not be reused: it has no policy.
const baseURL = 'http://127.0.0.1:5173/';

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.prod.spec.ts',
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL, trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && npx vite preview',
    url: baseURL,
    reuseExistingServer: false,
  },
});
