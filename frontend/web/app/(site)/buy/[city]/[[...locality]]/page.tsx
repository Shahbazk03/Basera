import type { Metadata } from 'next';
import { SearchRoute, searchMetadata, type SearchRouteProps } from '@/components/search/search-route';

export async function generateMetadata(props: SearchRouteProps): Promise<Metadata> {
  return searchMetadata('buy', props);
}

export default function BuyPage(props: SearchRouteProps) {
  return <SearchRoute mode="buy" props={props} />;
}
