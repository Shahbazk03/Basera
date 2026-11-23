'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { enumLabel, formatRelative } from '@estate/shared';
import { Badge, StatusBadge, Table, TBody, TD, TH, THead, TR } from '@estate/ui';
import type { ProjectListRow } from './types';

export function ProjectsTable({ rows, showOrg }: { rows: ProjectListRow[]; showOrg: boolean }) {
  const router = useRouter();
  return (
    <Table>
      <THead>
        <tr>
          <TH>Project</TH>
          <TH className="hidden md:table-cell">Location</TH>
          {showOrg ? <TH className="hidden xl:table-cell">Managed by</TH> : null}
          <TH>Status</TH>
          <TH className="hidden sm:table-cell">Review</TH>
          <TH align="right" className="hidden lg:table-cell">
            Available
          </TH>
          <TH className="hidden sm:table-cell">Updated</TH>
        </tr>
      </THead>
      <TBody>
        {rows.map((r) => (
          <TR key={r.id} onClick={() => router.push(`/projects/${r.id}`)}>
            <TD>
              <div className="flex items-center gap-3">
                <div className="h-11 w-16 shrink-0 overflow-hidden rounded-md bg-ink-100">{r.heroImageUrl ? <img src={r.heroImageUrl} alt="" className="size-full object-cover" /> : null}</div>
                <div className="min-w-0">
                  <Link href={`/projects/${r.id}`} className="line-clamp-1 font-medium text-ink-900 hover:underline" onClick={(e) => e.stopPropagation()}>
                    {r.name}
                  </Link>
                  <div className="mt-0.5 flex items-center gap-1.5 whitespace-nowrap text-xs text-ink-500">
                    <span>{enumLabel(r.projectType)}</span>
                    {r.isPublished ? <Badge tone="success" size="sm">Live</Badge> : <Badge tone="neutral" size="sm">Not published</Badge>}
                    {r.isFeatured ? <Badge tone="brand" size="sm">Featured</Badge> : null}
                    {r.isDemo ? <Badge tone="outline" size="sm">Demo</Badge> : null}
                  </div>
                </div>
              </div>
            </TD>
            <TD className="hidden md:table-cell">
              <div className="text-ink-800">{r.locality.name}</div>
              <div className="text-xs text-ink-500">{r.city.name}</div>
            </TD>
            {showOrg ? (
              <TD className="hidden xl:table-cell">
                <div className="max-w-48 truncate text-ink-800">{r.organization.name}</div>
                {r.developerOrg && r.developerOrg.id !== r.organization.id ? <div className="text-xs text-ink-500">Developer: {r.developerOrg.name}</div> : null}
              </TD>
            ) : null}
            <TD>
              <div className="flex flex-col items-start gap-1">
                <StatusBadge status={r.computedStatus} />
                {r.computedStatus !== r.status ? <span className="text-[11px] text-ink-500">updating from {enumLabel(r.status).toLowerCase()}</span> : null}
              </div>
            </TD>
            <TD className="hidden sm:table-cell">
              <StatusBadge status={r.reviewStatus} size="sm" />
            </TD>
            <TD align="right" className="tabular hidden lg:table-cell">
              {r.units.total ? (
                <>
                  <span className="font-medium text-ink-900">{r.units.available}</span>
                  <span className="text-ink-500"> / {r.units.total}</span>
                </>
              ) : (
                <span className="text-ink-400">No units</span>
              )}
            </TD>
            <TD className="hidden whitespace-nowrap text-xs text-ink-500 sm:table-cell">{formatRelative(r.updatedAt)}</TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
