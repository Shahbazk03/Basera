'use client';

import * as React from 'react';
import { Printer } from 'lucide-react';
import { enumLabel, formatDate, formatINR } from '@estate/shared';
import { Badge, Button, StatusBadge } from '@estate/ui';

export interface PayslipDetail {
  id: string;
  status: string;
  runStatus: string;
  period: string;
  periodStart: string;
  periodEnd: string;
  company: { name: string; address: string | null };
  employee: { id: string; employeeCode: string; name: string; email: string | null; department: string | null; designation: string | null; joiningDate: string; bankAccountLast4: string | null; workLocation: string | null };
  workingDays: number;
  payableDays: number;
  lopDays: number;
  earnings: { code: string; name: string; amount: number; calculation: string }[];
  deductions: { code: string; name: string; amount: number; calculation: string }[];
  grossEarnings: number;
  totalDeductions: number;
  netPay: number;
  payments: { amount: number; paidOn: string; method: string; referenceNo: string | null }[];
  isSelf: boolean;
}

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function twoDigits(n: number): string {
  return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? `-${ONES[n % 10]}` : ''}`;
}
function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h]} hundred` : '', r ? twoDigits(r) : ''].filter(Boolean).join(' ');
}

/** Indian numbering (crore / lakh / thousand) — e.g. 71200 → "Rupees seventy-one thousand two hundred only". */
export function rupeesInWords(amount: number): string {
  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);
  if (rupees === 0 && paise === 0) return 'Rupees zero only';
  const parts: string[] = [];
  const crore = Math.floor(rupees / 10_000_000);
  const lakh = Math.floor((rupees % 10_000_000) / 100_000);
  const thousand = Math.floor((rupees % 100_000) / 1000);
  const rest = rupees % 1000;
  if (crore) parts.push(`${threeDigits(crore)} crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} thousand`);
  if (rest) parts.push(threeDigits(rest));
  const words = `Rupees ${parts.join(' ')}${paise ? ` and ${twoDigits(paise)} paise` : ''} only`;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function LineTable({ title, rows, total, totalLabel }: { title: string; rows: PayslipDetail['earnings']; total: number; totalLabel: string }) {
  return (
    <div className="flex flex-col rounded-lg border border-line">
      <div className="border-b border-line bg-ink-50/70 px-4 py-2 text-[12px] font-semibold uppercase tracking-wide text-ink-500">{title}</div>
      <table className="w-full text-[13.5px]">
        <tbody className="divide-y divide-line">
          {rows.length ? (
            rows.map((r, i) => (
              <tr key={`${r.code}-${i}`}>
                <td className="px-4 py-2.5 align-top">
                  <div className="font-medium text-ink-900">{r.name}</div>
                  <div className="text-[11.5px] text-ink-500">{r.calculation}</div>
                </td>
                <td className="tabular whitespace-nowrap px-4 py-2.5 text-right align-top text-ink-900">{formatINR(r.amount, { precise: true })}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td className="px-4 py-3 text-ink-500" colSpan={2}>
                None
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="mt-auto flex justify-between border-t border-line px-4 py-2.5 text-[13.5px] font-semibold text-ink-900">
        <span>{totalLabel}</span>
        <span className="tabular">{formatINR(total, { precise: true })}</span>
      </div>
    </div>
  );
}

export function PayslipView({ data }: { data: PayslipDetail }) {
  const paid = data.payments.reduce((a, p) => a + p.amount, 0);
  return (
    <>
      <style>{`@media print { body * { visibility: hidden !important; } #payslip, #payslip * { visibility: visible !important; } #payslip { position: absolute; inset: 0; margin: 0; border: 0; box-shadow: none; } .no-print { display: none !important; } }`}</style>
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <StatusBadge status={data.status} />
          {data.runStatus === 'CANCELLED' ? <Badge tone="danger">Run cancelled</Badge> : null}
        </div>
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer /> Print / save as PDF
        </Button>
      </div>
      <article id="payslip" className="rounded-xl border border-line bg-surface p-6 shadow-card sm:p-8">
        <header className="flex flex-col justify-between gap-4 border-b border-line pb-5 sm:flex-row sm:items-start">
          <div>
            <p className="font-display text-lg font-semibold text-ink-900">{data.company.name || 'Company'}</p>
            {data.company.address ? <p className="mt-0.5 text-[13px] text-ink-500">{data.company.address}</p> : null}
          </div>
          <div className="sm:text-right">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-500">Payslip</p>
            <p className="font-display text-xl font-semibold text-ink-900">{data.period}</p>
            <p className="text-[12.5px] text-ink-500">
              {formatDate(data.periodStart)} – {formatDate(data.periodEnd)}
            </p>
          </div>
        </header>

        <section className="grid gap-x-8 gap-y-3 border-b border-line py-5 text-[13.5px] sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Employee', data.employee.name],
            ['Employee code', data.employee.employeeCode],
            ['Designation', data.employee.designation ?? '—'],
            ['Department', data.employee.department ?? '—'],
            ['Date of joining', formatDate(data.employee.joiningDate)],
            ['Work location', data.employee.workLocation ?? '—'],
            ['Bank account', data.employee.bankAccountLast4 ? `XXXX ${data.employee.bankAccountLast4}` : '—'],
            ['Pay days', `${data.payableDays} of ${data.workingDays}${data.lopDays ? ` (LOP ${data.lopDays})` : ''}`],
          ].map(([label, value]) => (
            <div key={label}>
              <p className="text-[12px] text-ink-500">{label}</p>
              <p className="font-medium text-ink-900">{value}</p>
            </div>
          ))}
        </section>

        <section className="grid gap-4 py-5 md:grid-cols-2">
          <LineTable title="Earnings" rows={data.earnings} total={data.grossEarnings} totalLabel="Gross earnings" />
          <LineTable title="Deductions" rows={data.deductions} total={data.totalDeductions} totalLabel="Total deductions" />
        </section>

        <section className="flex flex-col justify-between gap-2 rounded-lg bg-ink-900 px-5 py-4 text-white sm:flex-row sm:items-center">
          <div>
            <p className="text-[12px] uppercase tracking-wide text-white/60">Net pay</p>
            <p className="text-[13px] text-white/80">{rupeesInWords(data.netPay)}</p>
          </div>
          <p className="tabular font-display text-2xl font-semibold">{formatINR(data.netPay, { precise: true })}</p>
        </section>

        {data.payments.length ? (
          <section className="mt-5 text-[13px] text-ink-600">
            <p className="font-medium text-ink-900">Payment</p>
            {data.payments.map((p, i) => (
              <p key={i}>
                {formatINR(p.amount, { precise: true })} paid on {formatDate(p.paidOn)} by {enumLabel(p.method)}
                {p.referenceNo ? ` (ref ${p.referenceNo})` : ''}
              </p>
            ))}
            {paid < data.netPay ? <p className="text-warning">Balance pending: {formatINR(data.netPay - paid, { precise: true })}</p> : null}
          </section>
        ) : null}
        <p className="mt-6 text-[11.5px] text-ink-400">This is a system-generated payslip. Calculation notes show how each amount was derived from the configured salary components.</p>
      </article>
    </>
  );
}
