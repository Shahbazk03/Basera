import { redirect } from 'next/navigation';
import { getSettings } from '@/lib/api-server';

export default async function BuyIndex() {
  const s = await getSettings();
  redirect(`/buy/${s.marketplace.defaultCitySlug || 'lucknow'}`);
}
