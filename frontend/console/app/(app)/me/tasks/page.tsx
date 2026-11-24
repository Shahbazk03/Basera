'use client';

import { PageHeader } from '@estate/ui';
import { useSession } from '@/lib/session';
import { TaskBoard } from '@/components/hr/task-board';

export default function MyTasksPage() {
  const { can, user } = useSession();
  return (
    <>
      <PageHeader title="My tasks" description="Work assigned to you. Update the status as you go." />
      <TaskBoard scope="mine" canCreate={can('task.manage', user.platformOrganizationId)} />
    </>
  );
}
