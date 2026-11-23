import fs from 'node:fs';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';

export const WEB = process.env.E2E_WEB_URL ?? 'http://localhost:3200';
export const CONSOLE = process.env.E2E_CONSOLE_URL ?? 'http://localhost:3300';
export const API = process.env.E2E_API_URL ?? 'http://localhost:4000';

/** Password of the seeded development accounts (from the root .env). */
export function seedPassword(): string {
  if (process.env.SEED_DEFAULT_PASSWORD) return process.env.SEED_DEFAULT_PASSWORD;
  const env = fs.readFileSync(path.resolve(__dirname, '..', '.env'), 'utf8');
  const line = env.split(/\r?\n/).find((l) => l.startsWith('SEED_DEFAULT_PASSWORD='));
  if (!line) throw new Error('SEED_DEFAULT_PASSWORD not found');
  return line.slice('SEED_DEFAULT_PASSWORD='.length).trim();
}

export function unique(prefix: string): string {
  return `${prefix}${Date.now().toString(36).slice(-6)}`;
}

/** A random valid Indian mobile number (starts with 9). */
export function mobile(): string {
  return `9${Math.floor(100_000_000 + Math.random() * 899_999_999)}`;
}

export async function consoleLogin(page: Page, email: string, password = seedPassword()) {
  await page.goto(`${CONSOLE}/login`);
  await page.fill('#identifier', email);
  await page.fill('#password', password);
  await page.click('button[type=submit]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60_000 });
}

export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'page should not scroll horizontally').toBeLessThanOrEqual(1);
}
