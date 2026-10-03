import { expect, test } from '@playwright/test';

test('the placeholder screen loads', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle('Playlist Repair');
  await expect(page.getByRole('heading', { level: 1, name: 'Playlist Repair' })).toBeVisible();
});
