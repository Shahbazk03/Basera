/**
 * Map provider abstraction: Google Maps Embed when a browser-restricted embed key is configured,
 * otherwise OpenStreetMap (no key required). No secret keys are ever sent to the browser.
 */
export function LocationMap({ lat, lng, approximate, label, zoom = 15 }: { lat: number; lng: number; approximate: boolean; label: string; zoom?: number }) {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY;
  let src: string;
  if (key) {
    src = `https://www.google.com/maps/embed/v1/${approximate ? 'view' : 'place'}?key=${encodeURIComponent(key)}&${approximate ? `center=${lat},${lng}` : `q=${lat},${lng}`}&zoom=${approximate ? 13 : zoom}`;
  } else {
    const d = approximate ? 0.03 : 0.008;
    const bbox = [lng - d, lat - d * 0.75, lng + d, lat + d * 0.75].map((n) => n.toFixed(5)).join('%2C');
    src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik${approximate ? '' : `&marker=${lat}%2C${lng}`}`;
  }
  return (
    <figure>
      <div className="overflow-hidden rounded-xl border border-line bg-ink-100">
        <iframe title={`Map of ${label}`} src={src} loading="lazy" referrerPolicy="no-referrer-when-downgrade" className="h-[320px] w-full border-0" />
      </div>
      <figcaption className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-500">
        <span>{approximate ? 'Approximate area — the exact address is shared by the lister on enquiry.' : label}</span>
        {!key ? (
          <a href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=${approximate ? 13 : 16}/${lat}/${lng}`} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-strong hover:underline">
            Open larger map
          </a>
        ) : null}
      </figcaption>
    </figure>
  );
}
