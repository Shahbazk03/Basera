import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { BadgeCheck, ClipboardCheck, Inbox, LineChart } from 'lucide-react';
import { Button } from '@estate/ui';
import { consoleUrl } from '@/lib/urls';

export const metadata: Metadata = {
  title: 'List your property',
  description: 'Sell or rent your property, or list as a broker or builder. Every listing is reviewed before it goes live.',
};

const STEPS = [
  { icon: <ClipboardCheck className="size-5" />, title: 'Create a free account', text: 'Register as an owner, broker or builder and tell us about your business.' },
  { icon: <BadgeCheck className="size-5" />, title: 'Add your listing', text: 'Photos, price and the details buyers ask for — the form adapts to plots, homes, shops or farmland.' },
  { icon: <Inbox className="size-5" />, title: 'Review & go live', text: 'Our team reviews every listing for accuracy before it is published.' },
  { icon: <LineChart className="size-5" />, title: 'Respond to enquiries', text: 'Enquiries arrive as leads with contact details, follow-up reminders and site-visit scheduling.' },
];

export default function SellPage() {
  return (
    <>
      <section className="relative isolate overflow-hidden bg-ink-950">
        <Image src="/images/partners-hero.jpg" alt="" fill priority sizes="100vw" className="-z-10 object-cover opacity-60" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-ink-950/90 to-ink-950/30" />
        <div className="container-page py-20 md:py-28">
          <div className="max-w-xl">
            <h1 className="text-[34px] font-extrabold leading-[1.1] text-white md:text-[46px]">List your property where serious buyers search</h1>
            <p className="mt-4 text-[16px] leading-relaxed text-white/80">Owners, brokers and builders can list homes, plots, commercial spaces and projects. Listings are reviewed before they go live, so buyers can trust what they see.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href="/partners/register?type=INDIVIDUAL_OWNER">I am an owner</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="border-white/30 bg-white/10 text-white hover:bg-white/20">
                <Link href="/partners/register?type=BROKERAGE">I am a broker or builder</Link>
              </Button>
            </div>
            <p className="mt-5 text-sm text-white/60">
              Already have an account?{' '}
              <a href={consoleUrl('/listings/new')} className="font-medium text-white underline">
                Add a listing
              </a>
            </p>
          </div>
        </div>
      </section>
      <section className="py-16 md:py-20">
        <div className="container-page">
          <h2 className="text-[26px] font-bold text-ink-900 md:text-[30px]">How it works</h2>
          <ol className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <div className="flex items-center gap-3">
                  <span className="grid size-11 place-items-center rounded-xl bg-brand-soft text-brand-strong">{s.icon}</span>
                  <span className="text-xs font-semibold uppercase tracking-wide text-ink-400">Step {i + 1}</span>
                </div>
                <h3 className="mt-4 text-[16px] font-semibold text-ink-900">{s.title}</h3>
                <p className="mt-1.5 text-[14px] leading-relaxed text-ink-500">{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </>
  );
}
