import { expect, test } from '@playwright/test';
import { API, CONSOLE, WEB, mobile, unique } from './support';

/**
 * A rejected password must be sent once, not again on every Enter press: each rejected attempt counts
 * towards the 15-minute lock (5 attempts). Runs on the website and the console with a fresh account.
 */
test('login forms never resend rejected credentials', async ({ page, request }) => {
  const email = `${unique('e2e.login.')}@example.com`;
  const password = 'E2e-Login-12345';
  const registered = await request.post(`${API}/api/v1/auth/register`, {
    headers: { Origin: WEB },
    data: { fullName: 'E2E Login Guard', email, phone: `+91${mobile()}`, password, acceptTerms: true },
  });
  expect(registered.ok()).toBeTruthy();

  for (const app of [WEB, CONSOLE]) {
    await page.context().clearCookies();
    let loginRequests = 0;
    const count = (r: { url(): string; method(): string }) => {
      if (r.method() === 'POST' && r.url().includes('/auth/login')) loginRequests += 1;
    };
    page.on('request', count);
    await page.goto(`${app}/login`);
    await page.fill('#identifier', email);
    await page.fill('#password', 'not-the-right-password');
    await page.press('#password', 'Enter');
    await expect(page.getByText('Incorrect email/mobile or password')).toBeVisible();
    // Six more presses after the rejection: with the old form each was a new failed attempt (lock at 5).
    for (let i = 0; i < 6; i += 1) {
      await page.press('#password', 'Enter');
      await expect(page.getByText(/were just rejected/)).toBeVisible();
    }
    expect(loginRequests).toBe(1);
    // The account is not locked: the right password works straight away.
    await page.fill('#password', password);
    await page.press('#password', 'Enter');
    await page.waitForURL((u) => !u.pathname.startsWith('/login'));
    expect(loginRequests).toBe(2);
    page.off('request', count);
  }
});

test('a second submit while the first is still in flight sends nothing', async ({ page }) => {
  for (const app of [WEB, CONSOLE]) {
    let requests = 0;
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/api/v1/auth/login', async (route) => {
      requests += 1;
      await held;
      await route.continue();
    });
    await page.goto(`${app}/login`);
    await page.fill('#identifier', 'nobody.at.all@example.com');
    await page.fill('#password', 'Any-Password-123');
    // requestSubmit ignores the disabled button, so only the in-flight guard can stop these.
    await page.evaluate(() => {
      const form = document.querySelector('form')!;
      form.requestSubmit();
      form.requestSubmit();
      form.requestSubmit();
    });
    await page.waitForTimeout(500);
    expect(requests).toBe(1);
    release();
    await expect(page.getByText('Incorrect email/mobile or password')).toBeVisible();
    await page.unroute('**/api/v1/auth/login');
  }
});
