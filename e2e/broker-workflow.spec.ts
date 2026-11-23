import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { CONSOLE, WEB, consoleLogin, mobile, unique } from './support';

/**
 * The core marketplace workflow across both apps (dev stack + seed accounts):
 * broker registers on the website → partner team verifies the organisation → broker lists a property
 * with a photo and submits it → operations approves → the listing is public → a visitor enquires →
 * the lead reaches the broker's CRM → broker logs a call and schedules a site visit.
 */
const PHOTO = path.join(__dirname, 'fixtures', 'test-photo.jpg');

function localInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Listing actions open a confirmation dialog whose confirm button repeats the action label. */
async function listingAction(page: Page, label: string) {
  await page.getByRole('button', { name: label, exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: label, exact: true }).click();
  await expect(dialog).toBeHidden();
}

test('broker registers, is verified, lists a property that goes live, and works the resulting lead', async ({ browser }) => {
  test.setTimeout(360_000);
  const id = unique('');
  const brokerEmail = `e2e.broker.${id}@example.com`;
  const brokerPassword = `E2e-broker-${id}7`;
  const agency = `E2E Realty ${id}`;
  const title = `E2E 3 BHK apartment ${id}`;

  // ── 1. Registration on the website (creates a PENDING organisation and logs the broker in).
  const brokerContext = await browser.newContext();
  const broker = await brokerContext.newPage();
  await broker.goto(`${WEB}/partners/register`);
  await broker.fill('#fullName', 'E2E Broker');
  await broker.fill('#phone', mobile());
  await broker.fill('#email', brokerEmail);
  await broker.fill('#password', brokerPassword);
  await broker.fill('#organizationName', agency);
  await broker.fill('#businessAddress', 'Vibhuti Khand, Gomti Nagar');
  await expect(broker.locator('#cityId option', { hasText: 'Lucknow' })).toHaveCount(1);
  await broker.selectOption('#cityId', { label: 'Lucknow' });
  await broker.getByText('I confirm the information is accurate').click();
  await broker.getByRole('button', { name: 'Create partner account' }).click();
  await expect(broker.getByRole('heading', { name: 'Registration received' })).toBeVisible();

  // ── 2. The partner team verifies the organisation.
  const staffContext = await browser.newContext();
  const staff = await staffContext.newPage();
  await consoleLogin(staff, 'partners@example.com');
  await staff.goto(`${CONSOLE}/partners?q=${encodeURIComponent(agency)}`);
  await staff.getByRole('link', { name: agency }).click();
  await expect(staff.getByText('Awaiting verification').first()).toBeVisible();
  await staff.getByRole('button', { name: 'Approve', exact: true }).first().click();
  await staff.getByRole('dialog').getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(staff.getByText('Verified', { exact: true }).first()).toBeVisible();

  // ── 3. The broker lists a property with a photo and submits it for review.
  await consoleLogin(broker, brokerEmail, brokerPassword);
  await broker.goto(`${CONSOLE}/listings/new`);
  const apartment = await broker.locator('#propertyTypeId option', { hasText: 'Apartment' }).first().getAttribute('value');
  await broker.selectOption('#propertyTypeId', apartment!);
  await broker.fill('#title', title);
  await broker.fill('#description', 'Well-ventilated 3 BHK on the fourth floor with covered parking, close to schools and the metro. Development test listing.');
  await broker.selectOption('#cityId', { label: 'Lucknow' });
  await expect(broker.locator('#localityId option', { hasText: /^Gomti Nagar$/ })).toHaveCount(1);
  await broker.selectOption('#localityId', { label: 'Gomti Nagar' });
  await broker.fill('#area', '1450');
  await broker.fill('#price', '8500000');
  await broker.fill('#bedrooms', '3');
  await broker.fill('#bathrooms', '3');
  await broker.selectOption('#furnishing', 'SEMI_FURNISHED');
  await broker.fill('#floorNumber', '4');
  await broker.fill('#totalFloors', '12');
  await broker.selectOption('#possessionStatus', 'READY_TO_MOVE');
  await broker.getByRole('button', { name: 'Save & add photos' }).click();
  await broker.waitForURL(/\/listings\/[0-9a-f-]{36}/);
  await broker.locator('input[type=file]').first().setInputFiles(PHOTO);
  await expect(broker.getByRole('button', { name: 'Save photos' })).toBeEnabled();
  await broker.getByRole('button', { name: 'Save photos' }).click();
  await expect(broker.getByText('Photos saved').first()).toBeVisible();
  await listingAction(broker, 'Submit for review');
  const listingUrl = broker.url().split('?')[0];

  // ── 4. Operations approves; the listing goes live.
  const opsContext = await browser.newContext();
  const ops = await opsContext.newPage();
  await consoleLogin(ops, 'ops@example.com');
  await ops.goto(listingUrl.replace(/^https?:\/\/[^/]+/, CONSOLE));
  await listingAction(ops, 'Approve');
  if (await ops.getByRole('button', { name: 'Publish', exact: true }).isVisible()) await listingAction(ops, 'Publish');

  // ── 5. A visitor finds it and enquires.
  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  await visitor.goto(`${WEB}/buy/lucknow?q=${encodeURIComponent(title)}`);
  await visitor.getByRole('link', { name: title }).first().click();
  await expect(visitor.getByRole('heading', { level: 1 })).toHaveText(title);
  await expect(visitor.getByText(agency).first()).toBeVisible();
  const customerPhone = mobile();
  await visitor.fill('#name-GENERAL', 'E2E Home Buyer');
  await visitor.fill('#phone-GENERAL', customerPhone);
  await visitor.locator('#consent-GENERAL').click();
  await visitor.waitForTimeout(3500); // the API rejects forms submitted faster than a person can fill them
  await visitor.getByRole('button', { name: 'Send enquiry' }).click();
  await expect(visitor.getByText('Thank you — we have your request')).toBeVisible();

  // ── 6. The lead is in the broker's CRM; the broker logs a call and schedules a site visit.
  await broker.goto(`${CONSOLE}/crm/leads?q=${customerPhone}`);
  await broker.getByText('E2E Home Buyer').first().click();
  await expect(broker.getByText(title).first()).toBeVisible();
  await broker.getByRole('button', { name: 'Log activity' }).first().click();
  const activity = broker.getByRole('dialog');
  await activity.locator('#act-summary').fill('Called the buyer; discussed price and visit timing');
  await activity.getByRole('button', { name: 'Log activity' }).click();
  await expect(activity).toBeHidden();
  await broker.getByRole('button', { name: 'Site visit' }).click();
  const visit = broker.getByRole('dialog');
  await visit.locator('#sv-when').fill(localInput(new Date(Date.now() + 2 * 86_400_000)));
  await visit.getByRole('button', { name: 'Schedule visit' }).click();
  await expect(visit).toBeHidden();
  await expect(broker.getByText('Site visit scheduled').first()).toBeVisible();
  await expect(broker.getByText('Called the buyer; discussed price and visit timing').first()).toBeVisible();

  await Promise.all([brokerContext.close(), staffContext.close(), opsContext.close(), visitorContext.close()]);
});
