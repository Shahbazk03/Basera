import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Requests for hostnames that are not mapped to an active project domain. */
export default function DomainNotFound() {
  notFound();
}
