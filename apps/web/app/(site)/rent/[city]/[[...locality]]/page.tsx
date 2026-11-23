import type { Metadata } from 'next';
import { SearchRoute, searchMetadata, type SearchRouteProps } from '@/components/search/search-route';

export async function generateMetadata(props: SearchRouteProps): Promise<Metadata> {
  return searchMetadata('rent', props);
}

export default function RentPage(props: SearchRouteProps) {
  return <SearchRoute mode="rent" props={props} />;
}
