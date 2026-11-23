import type { ProjectDetail } from '@estate/shared';

/** schema.org description of a residential/commercial development (no invented ratings or offers). */
export function projectJsonLd(p: ProjectDetail, url: string): Record<string, unknown> {
  const images = [p.heroImageUrl, ...p.media.filter((m) => m.type === 'IMAGE').map((m) => m.url)].filter(Boolean).slice(0, 6);
  return {
    '@context': 'https://schema.org',
    '@type': p.projectType === 'COMMERCIAL' ? 'Place' : 'Residence',
    name: p.name,
    description: p.seo.description,
    url,
    image: images.map((i) => (i!.startsWith('/') ? new URL(i!, url).toString() : i)),
    address: {
      '@type': 'PostalAddress',
      streetAddress: p.addressLine ?? undefined,
      addressLocality: `${p.locality.name}, ${p.city.name}`,
      addressRegion: p.state.name,
      postalCode: p.pincode ?? undefined,
      addressCountry: 'IN',
    },
    ...(p.latitude != null && p.longitude != null ? { geo: { '@type': 'GeoCoordinates', latitude: p.latitude, longitude: p.longitude } } : {}),
    ...(p.amenities.length ? { amenityFeature: p.amenities.map((a) => ({ '@type': 'LocationFeatureSpecification', name: a.name, value: true })) } : {}),
    ...(p.priceMin != null
      ? {
          offers: {
            '@type': 'AggregateOffer',
            priceCurrency: 'INR',
            lowPrice: p.priceMin,
            highPrice: p.priceMax ?? p.priceMin,
            availability: p.availableUnits > 0 ? 'https://schema.org/InStock' : 'https://schema.org/SoldOut',
          },
        }
      : {}),
  };
}
