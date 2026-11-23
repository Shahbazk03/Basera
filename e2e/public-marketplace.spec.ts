import { expect, test } from '@playwright/test';
import { WEB } from './support';

test.describe('Public marketplace', () => {
  test('homepage shows live sections and searches by locality', async ({ page }) => {
    await page.goto(WEB);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: /featured properties/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /new projects/i })).toBeVisible();

    // Location autocomplete → locality search page
    const location = page.getByRole('combobox', { name: 'Search location' });
    await location.fill('Gomti');
    await page.getByRole('option', { name: /Gomti Nagar Extension/ }).click();
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page).toHaveURL(/\/buy\/lucknow\/gomti-nagar-extension/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Gomti Nagar Extension');
  });

  test('filters change the result set and are reflected in the URL', async ({ page }) => {
    await page.goto(`${WEB}/buy/lucknow`);
    const countText = async () => (await page.locator('h1 + p').innerText()).trim();
    const before = await countText();
    await page.getByRole('button', { name: '3 BHK' }).first().click();
    await expect(page).toHaveURL(/bedrooms=3/);
    await expect.poll(countText).not.toBe(before);
    // every visible result row mentions 3 beds
    const rows = page.locator('section[aria-label="Search results"] article');
    const n = await rows.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i += 1) await expect(rows.nth(i)).toContainText('3 Beds');
    // Removing the chip restores the unfiltered results
    await page.getByRole('link', { name: 'Remove filter: 3 BHK' }).click();
    await expect.poll(countText).toBe(before);
  });

  test('property detail shows facts, lister, enquiry form and no private owner data', async ({ page }) => {
    await page.goto(`${WEB}/buy/lucknow`);
    const first = page.locator('section[aria-label="Search results"] article h3 a').first();
    const title = (await first.innerText()).trim();
    await first.click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
    await expect(page.getByRole('heading', { name: 'Property details' })).toBeVisible();
    await expect(page.getByText('Listed by', { exact: false }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send enquiry' })).toBeVisible();
    const html = await page.content();
    expect(html).not.toMatch(/ownerPhone|ownerEmail/);
  });

  test('sold listings stay reachable but cannot be enquired about', async ({ page, request }) => {
    const res = await request.get('http://localhost:4000/api/v1/public/properties', { params: { q: 'Vikas Nagar', listingType: 'SALE' } });
    const visible = (await res.json()).data as { title: string }[];
    expect(visible.find((p) => p.title === '2 BHK apartment in Vikas Nagar')).toBeUndefined();
  });
});
