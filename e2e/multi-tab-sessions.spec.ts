import { expect, test, type Page } from '@playwright/test';
import { CONSOLE, consoleLogin } from './support';

/**
 * Two accounts in two tabs of ONE browser (one cookie jar, like one Chrome profile). The first sign-in is
 * the browser's main account; a fresh tab that signs in while it is in use keeps its own account.
 * Demo accounts: ops@ (Rahul Bhatnagar), sales1@ (Nikhil Shukla), admin@ (Meera Kapoor).
 */
const NAMES = /Rahul Bhatnagar|Nikhil Shukla|Meera Kapoor/;
const userMenu = (page: Page) => page.locator('header').getByRole('button', { name: NAMES });
const tabSlot = (page: Page) => page.evaluate(() => window.sessionStorage.getItem('estate.sessionSlot'));

async function expectSignedInAs(page: Page, name: string) {
  await expect(userMenu(page)).toContainText(name);
}

test('two tabs of one browser stay signed in to different accounts', async ({ browser }) => {
  const context = await browser.newContext();
  const tabA = await context.newPage();
  await consoleLogin(tabA, 'ops@example.com');
  await expectSignedInAs(tabA, 'Rahul Bhatnagar');

  // The everyday case: open a new tab, go to the sign-in page, sign in as someone else.
  const tabB = await context.newPage();
  await consoleLogin(tabB, 'sales1@example.com');
  await expectSignedInAs(tabB, 'Nikhil Shukla');
  await tabA.reload();
  await expectSignedInAs(tabA, 'Rahul Bhatnagar');
  await tabB.reload();
  await expectSignedInAs(tabB, 'Nikhil Shukla');

  // A new tab opens with the browser's main account; the menu switches only that tab.
  const tabC = await context.newPage();
  await tabC.goto(`${CONSOLE}/`);
  await expectSignedInAs(tabC, 'Rahul Bhatnagar');
  await userMenu(tabC).click();
  await tabC.getByRole('menuitem', { name: 'Use another account in this tab' }).click();
  await tabC.waitForURL(/\/login/);
  await consoleLogin(tabC, 'admin@example.com');
  await expectSignedInAs(tabC, 'Meera Kapoor');

  // Exports are fetched as the tab's own account (a plain link could only use the main account).
  await tabC.goto(`${CONSOLE}/crm/leads`);
  const exportRequest = tabC.waitForRequest((r) => r.url().includes('/crm/leads/export'));
  const download = tabC.waitForEvent('download');
  await tabC.getByRole('button', { name: 'Export' }).click();
  expect((await exportRequest).headers()['x-session-slot']).toBe(await tabSlot(tabC));
  expect((await download).suggestedFilename()).toMatch(/\.csv$/);

  // Signing tab B out leaves the other tabs signed in, and tab B stays signed out.
  await userMenu(tabB).click();
  await tabB.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
  await tabB.waitForURL(/\/login/);
  await tabA.reload();
  await expectSignedInAs(tabA, 'Rahul Bhatnagar');
  await tabC.reload();
  await expectSignedInAs(tabC, 'Meera Kapoor');
  await tabB.goto(`${CONSOLE}/`);
  await tabB.waitForURL(/\/login/);

  // "Sign out of all accounts" ends every account in this browser.
  await userMenu(tabA).click();
  await tabA.getByRole('menuitem', { name: 'Sign out of all accounts' }).click();
  await tabA.waitForURL(/\/login/);
  await tabC.reload();
  await tabC.waitForURL(/\/login/);
  await context.close();
});
