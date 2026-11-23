'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { PageHeader, toast } from '@estate/ui';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { ProjectForm } from '@/components/projects/project-form';

export default function NewProjectPage() {
  const router = useRouter();
  const { user, can } = useSession();
  const orgOptions = user.memberships
    .filter((m) => (m.organizationType === 'PLATFORM' || m.organizationType === 'DEVELOPER') && can('project.create', m.organizationId))
    .map((m) => ({ id: m.organizationId, name: m.organizationName }));

  return (
    <>
      <PageHeader
        breadcrumbs={
          <Link href="/projects" className="inline-flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900">
            <ChevronLeft className="size-4" /> Projects
          </Link>
        }
        title="New project"
        description="Projects start as drafts with a default microsite layout. Add photos and inventory, then submit for review or publish."
      />
      <ProjectForm
        mode="create"
        organizationOptions={orgOptions}
        onSubmit={async (values) => {
          const created = await api.post<{ id: string }>('/projects', values);
          toast.success('Project created. Add photos and inventory next.');
          router.push(`/projects/${created.id}?tab=media`);
        }}
      />
    </>
  );
}
