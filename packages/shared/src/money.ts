/** Money helpers. All calculations are done in integer paise to avoid floating point drift. */

export function toPaise(rupees: number | string | null | undefined): number {
  if (rupees === null || rupees === undefined || rupees === '') return 0;
  const n = typeof rupees === 'string' ? Number(rupees) : rupees;
  if (!Number.isFinite(n)) throw new Error(`Invalid money amount: ${rupees}`);
  return Math.round(n * 100);
}

export function fromPaise(paise: number): number {
  return Math.round(paise) / 100;
}

/** Percentage of an amount in paise, rounded half away from zero to the nearest paisa. */
export function percentOfPaise(paise: number, percent: number): number {
  const raw = (paise * percent) / 100;
  return raw < 0 ? -Math.round(-raw) : Math.round(raw);
}

export function roundMoney(rupees: number): number {
  return fromPaise(toPaise(rupees));
}
