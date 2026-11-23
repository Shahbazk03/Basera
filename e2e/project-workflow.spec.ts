import path from 'node:path';
import { expect, test } from '@playwright/test';
import { CONSOLE, WEB, consoleLogin, mobile, unique } from './support';

/**
 * Project workflow across both apps (runs against the dev stack and seed data):
 * admin creates a project with a booking window and a hero image, adds a unit and publishes it →
 * the public project page shows it with booking open → a visitor enquires about the unit →
 * the enquiry arrives in the CRM as a lead linked to the project.
 */
const PHOTO = path.join(__dirname, 'fixtures', 'test-photo.jpg');

function localInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

test('admin publishes a project with inventory; a visitor enquires about a unit; the lead reaches the CRM', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const id = unique('');
  const name = `E2E Heights ${id}`;
  const slug = `e2e-heights-${id}`;

  // ── Console: create the project.
  await consoleLogin(page, 'admin@example.com');
  await page.goto(`${CONSOLE}/projects/new`);
  if (await page.locator('#organizationId').isVisible()) await page.selectOption('#organizationId', { label: 'Basera' });
  await page.fill('#name', name);
  await page.selectOption('#projectType', 'APARTMENTS');
  await page.fill('#slug', slug);
  await page.fill('#description', 'Development test project created by the end-to-end suite to verify the project workflow.');
  await page.selectOption('#cityId', { label: 'Lucknow' });
  await expect(page.locator('#localityId')).toBeEnabled();
  await expect(page.locator('#localityId option', { hasText: /^Gomti Nagar$/ })).toHaveCount(1);
  await page.selectOption('#localityId', { label: 'Gomti Nagar' });
  await page.locator('input[type=file]').first().setInputFiles(PHOTO);
  await expect(page.getByRole('button', { name: 'Replace' }).first()).toBeVisible();
  await expect(page.locator('#autoStatus')).toHaveAttribute('aria-checked', 'true');
  await page.fill('#bookingOpensAt', localInput(new Date(Date.now() - 86_400_000)));
  await page.fill('#bookingClosesAt', localInput(new Date(Date.now() + 30 * 86_400_000)));
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}/);
  const projectId = /projects\/([0-9a-f-]{36})/.exec(page.url())![1];

  // ── Inventory: one available unit.
  await page.goto(`${CONSOLE}/projects/${projectId}?tab=inventory`);
  await page.getByRole('button', { name: 'Add unit' }).click();
  const unitDialog = page.getByRole('dialog');
  await unitDialog.locator('#ucode').fill('T1-1203');
  await unitDialog.locator('#utype').selectOption('FLAT');
  await unitDialog.locator('#uconf').fill('3 BHK');
  await unitDialog.locator('#uarea').fill('1650');
  await unitDialog.locator('#uunit').selectOption('SQFT');
  await unitDialog.locator('#ubase').fill('9500000');
  await unitDialog.locator('#ustatus').selectOption('AVAILABLE');
  await unitDialog.getByRole('button', { name: 'Add unit' }).click();
  await expect(unitDialog).toBeHidden();
  await expect(page.getByText('T1-1203').first()).toBeVisible();

  // ── Publish (the company organisation publishes directly).
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(page.getByText('Live', { exact: true }).first()).toBeVisible();

  // ── Website: the project is public with booking open; a visitor enquires about the unit.
  const visitor = await browser.newPage();
  await visitor.goto(`${WEB}/projects/${slug}`);
  await expect(visitor.getByRole('heading', { level: 1 })).toHaveText(name);
  await expect(visitor.getByText('Booking open').first()).toBeVisible();
  await visitor.locator('tr', { hasText: 'T1-1203' }).getByRole('button', { name: 'Enquire' }).click();
  const form = visitor.getByRole('dialog');
  const phone = mobile();
  await form.locator('#name-UNIT_ENQUIRY').fill('E2E Unit Buyer');
  await form.locator('#phone-UNIT_ENQUIRY').fill(phone);
  await form.locator('#consent-UNIT_ENQUIRY').click();
  await visitor.waitForTimeout(3500); // the API rejects forms submitted faster than a person can fill them
  await form.getByRole('button', { name: 'Send unit enquiry' }).click();
  await expect(form.getByText('Thank you — we have your request')).toBeVisible();
  await expect(form.getByText(/^ENQ-\d{4}-\d{6}$/)).toBeVisible();
  await visitor.close();

  // ── CRM: the lead exists, linked to the project.
  await page.goto(`${CONSOLE}/crm/leads?q=${phone}`);
  await page.getByText('E2E Unit Buyer').first().click();
  await expect(page.getByText(name).first()).toBeVisible();
});
