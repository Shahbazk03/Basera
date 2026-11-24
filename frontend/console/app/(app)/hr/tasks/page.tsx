'use client';

import { PageHeader } from '@estate/ui';
import { TaskBoard } from '@/components/hr/task-board';

export default function HrTasksPage() {
  return (
    <>
      <PageHeader title="Tasks" description="Assign follow-up work to employees and track it to completion." />
      <TaskBoard scope="all" canCreate />
    </>
  );
}
