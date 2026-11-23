'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatArea, formatPriceCompact, formatRelative } from '@estate/shared';
import { Badge, StatusBadge, Table, TBody, TD, TH, THead, TR } from '@estate/ui';

export interface ListingRow {
  id: string;
  referenceCode: string;
  slug: string;
  title: string;
  status: string;
  verificationStatus: string;
  listingType: 'SALE' | 'RENT';
  price: number;
  area: number;
  areaUnit: string;
  coverImageUrl: string | null;
  isFeatured: boolean;
  isDemo: boolean;
  viewCount: number;
  enquiryCount: number;
  submittedAt: string | null;
  updatedAt: string;
  rejectionReason: string | null;
  propertyType: { name: string };
  locality: { name: string };
  organization: { id: string; name: string; type: string; status: string };
  listedBy: { id: string; fullName: string };
}

export function ListingsTable({ rows, showOrg }: { rows: ListingRow[]; showOrg: boolean }) {
  const router = useRouter();
  return (
    <Table>
      <THead>
        <tr>
          <TH>Listing</TH>
          <TH className="hidden md:table-cell">Type & locality</TH>
          {showOrg ? <TH className="hidden xl:table-cell">Listed by</TH> : null}
          <TH align="right">Price</TH>
          <TH>Status</TH>
          <TH className="hidden lg:table-cell" align="right">
            Views
          </TH>
          <TH className="hidden sm:table-cell">Updated</TH>
        </tr>
      </THead>
      <TBody>
        {rows.map((r) => (
          <TR key={r.id} onClick={() => router.push(`/listings/${r.id}`)}>
            <TD>
              <div className="flex items-center gap-3">
                <div className="h-11 w-16 shrink-0 overflow-hidden rounded-md bg-ink-100">{r.coverImageUrl ? <img src={r.coverImageUrl} alt="" className="size-full object-cover" /> : null}</div>
                <div className="min-w-0">
                  <Link href={`/listings/${r.id}`} className="line-clamp-1 font-medium text-ink-900 hover:underline" onClick={(e) => e.stopPropagation()}>
                    {r.title}
                  </Link>
                  <div className="mt-0.5 flex items-center gap-1.5 whitespace-nowrap text-xs text-ink-500">
                    <span className="tabular">{r.referenceCode}</span>
                    <span>·</span>
                    <span>{r.listingType === 'RENT' ? 'Rent' : 'Sale'}</span>
                    {r.isFeatured ? <Badge tone="brand" size="sm">Featured</Badge> : null}
                    {r.isDemo ? <Badge tone="outline" size="sm">Demo</Badge> : null}
                  </div>
                </div>
              </div>
            </TD>
            <TD className="hidden md:table-cell">
              <div className="text-ink-800">{r.propertyType.name}</div>
              <div className="text-xs text-ink-500">
                {r.locality.name} · {formatArea(r.area, r.areaUnit)}
              </div>
            </TD>
            {showOrg ? (
              <TD className="hidden xl:table-cell">
                <div className="max-w-48 truncate text-ink-800">{r.organization.name}</div>
                <div className="text-xs text-ink-500">{r.listedBy.fullName}</div>
              </TD>
            ) : null}
            <TD align="right" className="tabular font-medium text-ink-900">
              {formatPriceCompact(r.price)}
              {r.listingType === 'RENT' ? <span className="text-xs font-normal text-ink-500">/mo</span> : null}
            </TD>
            <TD>
              <div className="flex flex-col items-start gap-1">
                <StatusBadge status={r.status} />
                {r.verificationStatus === 'VERIFIED' ? <span className="text-[11px] text-success">Verified</span> : null}
              </div>
            </TD>
            <TD align="right" className="tabular hidden lg:table-cell">
              {r.viewCount.toLocaleString('en-IN')}
            </TD>
            <TD className="hidden whitespace-nowrap text-xs text-ink-500 sm:table-cell">{formatRelative(r.updatedAt)}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

