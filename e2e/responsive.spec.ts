import { expect, test } from '@playwright/test';
import { expectNoHorizontalOverflow, WEB } from './support';

test.describe('Responsive layout (mobile)', () => {
  for (const path of ['/', '/buy/lucknow', '/projects', '/sell', '/partners/register', '/login']) {
    test(`no horizontal overflow on ${path}`, async ({ page }) => {
      await page.goto(`${WEB}${path}`);
      await page.waitForLoadState('networkidle');
      await expectNoHorizontalOverflow(page);
    });
  }

  test('mobile search uses the filter sheet', async ({ page }) => {
    await page.goto(`${WEB}/buy/lucknow`);
    await page.getByRole('button', { name: /^Filters/ }).click();
    await expect(page.getByRole('dialog', { name: 'Filters' })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: '2 BHK' }).click();
    await expect(page).toHaveURL(/bedrooms=2/);
  });

  test('mobile navigation menu opens', async ({ page }) => {
    await page.goto(WEB);
    await page.getByRole('button', { name: 'Open menu' }).click();
    await expect(page.getByRole('navigation', { name: 'Mobile' }).getByRole('link', { name: 'Rent' })).toBeVisible();
  });
});
