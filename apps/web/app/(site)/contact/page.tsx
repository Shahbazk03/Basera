import type { Metadata } from 'next';
import { getSettings } from '@/lib/api-server';
import { EnquiryForm } from '@/components/enquiry/enquiry-form';
import { ContactCard, hasContactDetails } from '../[page]/_cms/contact-card';
import { buildMetadata, getSeoOverride } from '../[page]/_cms/seo';

export const revalidate = 60;

export async function generateMetadata(): Promise<Metadata> {
  const [settings, override] = await Promise.all([getSettings(), getSeoOverride('/contact')]);
  return buildMetadata('/contact', { title: 'Contact us', description: `Talk to ${settings.brand.name} about buying, renting or listing property.` }, override);
}

export default async function ContactPage() {
  const settings = await getSettings();
  const showDetails = hasContactDetails(settings.contact);
  return (
    <>
      <header className="border-b border-line bg-canvas">
        <div className="container-page py-10 md:py-14">
          <h1 className="text-[30px] leading-tight font-extrabold text-ink-900 md:text-[38px]">Contact us</h1>
          <p className="mt-3 max-w-2xl text-[16px] leading-relaxed text-ink-600">
            Tell us what you are looking for — a home, a plot, a commercial space or help listing your property. You get a reference number, and a relationship manager follows up.
          </p>
        </div>
      </header>
      <div className="container-page py-10 md:py-14">
        <div className={`grid gap-8 ${showDetails ? 'lg:grid-cols-[minmax(0,1fr)_360px]' : 'max-w-2xl'}`}>
          <section aria-labelledby="contact-form-title" className="rounded-2xl border border-line bg-surface p-6 md:p-8">
            <h2 id="contact-form-title" className="text-[20px] font-bold text-ink-900">
              Send us a message
            </h2>
            <p className="mt-1 mb-6 text-[14px] text-ink-500">Your details are used only to respond to this request.</p>
            <EnquiryForm type="GENERAL" submitLabel="Send message" messagePlaceholder="How can we help?" />
          </section>
          {showDetails ? (
            <aside aria-label="Contact details" className="h-fit">
              <ContactCard settings={settings} />
            </aside>
          ) : null}
        </div>
      </div>
    </>
  );
}
