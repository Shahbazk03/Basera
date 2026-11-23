import { Clock, Mail, MapPin, MessageCircle, Phone } from 'lucide-react';
import type { PublicSettings } from '@estate/shared';

/** Digits only, with India's country code for wa.me links. */
function waNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return digits.length === 10 ? `91${digits}` : digits;
}

/** Company contact details from admin settings. Empty values are not shown (nothing is invented). */
export function hasContactDetails(c: PublicSettings['contact']): boolean {
  return Boolean(c.phone || c.whatsapp || c.email || c.address || c.hours);
}

export function ContactCard({ settings, className }: { settings: PublicSettings; className?: string }) {
  const c = settings.contact;
  if (!hasContactDetails(c)) return null;
  const rows: { icon: React.ReactNode; label: string; value: React.ReactNode }[] = [];
  if (c.phone) rows.push({ icon: <Phone className="size-4" />, label: 'Phone', value: <a href={`tel:${c.phone.replace(/\s/g, '')}`} className="font-medium text-ink-900 hover:text-brand-strong">{c.phone}</a> });
  if (c.whatsapp)
    rows.push({
      icon: <MessageCircle className="size-4" />,
      label: 'WhatsApp',
      value: (
        <a href={`https://wa.me/${waNumber(c.whatsapp)}`} target="_blank" rel="noopener noreferrer" className="font-medium text-ink-900 hover:text-brand-strong">
          {c.whatsapp}
        </a>
      ),
    });
  if (c.email) rows.push({ icon: <Mail className="size-4" />, label: 'Email', value: <a href={`mailto:${c.email}`} className="font-medium break-all text-ink-900 hover:text-brand-strong">{c.email}</a> });
  if (c.address) rows.push({ icon: <MapPin className="size-4" />, label: 'Office', value: <span className="whitespace-pre-line text-ink-800">{c.address}</span> });
  if (c.hours) rows.push({ icon: <Clock className="size-4" />, label: 'Hours', value: <span className="text-ink-800">{c.hours}</span> });
  return (
    <div className={`rounded-xl border border-line bg-surface p-5 ${className ?? ''}`}>
      <p className="text-[15px] font-semibold text-ink-900">{settings.company.legalName || settings.brand.name}</p>
      <dl className="mt-4 grid gap-3.5">
        {rows.map((r) => (
          <div key={r.label} className="flex gap-3">
            <dt className="mt-0.5 text-ink-400">
              {r.icon}
              <span className="sr-only">{r.label}</span>
            </dt>
            <dd className="text-[14.5px] leading-relaxed">{r.value}</dd>
          </div>
        ))}
      </dl>
      {settings.company.reraAgentNumber ? <p className="mt-4 text-xs text-ink-500">RERA agent registration: {settings.company.reraAgentNumber}</p> : null}
    </div>
  );
}
