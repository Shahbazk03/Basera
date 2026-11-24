import { redirect } from 'next/navigation';
import { getSettings } from '@/lib/api-server';

export default async function RentIndex() {
  const s = await getSettings();
  redirect(`/rent/${s.marketplace.defaultCitySlug || 'lucknow'}`);
}
