import * as React from 'react';
import {
  ArrowUpDown,
  BrickWall,
  Building2,
  Car,
  Cctv,
  CircleCheck,
  CloudRain,
  Coffee,
  Compass,
  Dices,
  Droplets,
  Dumbbell,
  Flame,
  Footprints,
  Lamp,
  Phone,
  Presentation,
  Recycle,
  Route,
  Shield,
  ShieldCheck,
  Trees,
  Truck,
  Users,
  Waves,
  Zap,
  Baby,
  Fence,
  type LucideIcon,
} from 'lucide-react';

/** Amenity icon keys stored in the database → icons. Unknown keys fall back to a check mark. */
const AMENITY_ICONS: Record<string, LucideIcon> = {
  lift: ArrowUpDown,
  power: Zap,
  shield: ShieldCheck,
  cctv: Cctv,
  gate: Fence,
  fire: Flame,
  parking: Car,
  phone: Phone,
  water: Droplets,
  rain: CloudRain,
  recycle: Recycle,
  flame: Flame,
  building: Building2,
  pool: Waves,
  gym: Dumbbell,
  play: Baby,
  tree: Trees,
  run: Footprints,
  users: Users,
  dice: Dices,
  compass: Compass,
  road: Route,
  lamp: Lamp,
  wall: BrickWall,
  presentation: Presentation,
  coffee: Coffee,
  truck: Truck,
  security: Shield,
};

export function AmenityIcon({ name, className }: { name: string | null | undefined; className?: string }) {
  const Icon = (name && AMENITY_ICONS[name]) || CircleCheck;
  return <Icon className={className} aria-hidden />;
}

export const AMENITY_ICON_KEYS = Object.keys(AMENITY_ICONS);

/** Brand mark: a simple roofline glyph — replaced by the uploaded logo when configured. */
export function BrandMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true}>
      {title ? <title>{title}</title> : null}
      <rect width="32" height="32" rx="8" fill="currentColor" />
      <path d="M8 16.2 16 9.5l8 6.7" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11 15v8h10v-8" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M14.5 23v-4.2h3V23" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ name, logoUrl, className, inverted }: { name: string; logoUrl?: string | null; className?: string; inverted?: boolean }) {
  if (logoUrl) return <img src={logoUrl} alt={name} className={className ?? 'h-8 w-auto'} />;
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      <BrandMark className={`size-8 ${inverted ? 'text-white/15' : 'text-brand'}`} />
      <span className={`font-display text-[19px] font-bold tracking-tight ${inverted ? 'text-white' : 'text-ink-900'}`}>{name}</span>
    </span>
  );
}

export type { React };
