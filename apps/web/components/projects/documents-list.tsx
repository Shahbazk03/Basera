'use client';

import * as React from 'react';
import { Download, FileText, Lock } from 'lucide-react';
import { enumLabel } from '@estate/shared';
import { errorMessage } from '@estate/api-client';
import { Button, toast } from '@estate/ui';
import { api } from '@/lib/api-browser';
import { EnquiryDialog } from '@/components/enquiry/enquiry-dialog';

/** Public documents download through short-lived links; "on request" documents are requested via an enquiry. */
export function DocumentsList({ slug, projectId, projectName, documents }: { slug: string; projectId: string; projectName: string; documents: { id: string; title: string; docType: string; visibility: string }[] }) {
  const [busy, setBusy] = React.useState<string | null>(null);
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
      {documents.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-ink-50 text-ink-500">{d.visibility === 'PUBLIC' ? <FileText className="size-4" /> : <Lock className="size-4" />}</span>
            <div className="min-w-0">
              <p className="truncate text-[14.5px] font-medium text-ink-900">{d.title}</p>
              <p className="text-xs text-ink-500">{enumLabel(d.docType)}</p>
            </div>
          </div>
          {d.visibility === 'PUBLIC' ? (
            <Button
              size="sm"
              variant="outline"
              loading={busy === d.id}
              onClick={async () => {
                setBusy(d.id);
                try {
                  const res = await api.get<{ url: string }>(`/public/projects/${encodeURIComponent(slug)}/documents/${d.id}/url`);
                  window.open(res.url, '_blank', 'noopener,noreferrer');
                } catch (err) {
                  toast.error(errorMessage(err));
                } finally {
                  setBusy(null);
                }
              }}
            >
              <Download /> Download
            </Button>
          ) : (
            <EnquiryDialog
              type="DOCUMENT_REQUEST"
              projectId={projectId}
              subject={`${projectName} · ${d.title}`}
              trigger={
                <Button size="sm" variant="outline">
                  Request copy
                </Button>
              }
            />
          )}
        </li>
      ))}
    </ul>
  );
}
