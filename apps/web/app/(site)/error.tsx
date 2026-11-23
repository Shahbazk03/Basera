'use client';

import { Button } from '@estate/ui';

export default function SiteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="grid min-h-[60vh] place-items-center bg-canvas px-6">
      <div className="max-w-md text-center">
        <h1 className="text-[24px] font-bold text-ink-900">Something went wrong</h1>
        <p className="mt-2 text-[15px] text-ink-500">We could not load this page right now. Please try again in a moment.</p>
        <Button className="mt-6" onClick={() => reset()}>
          Try again
        </Button>
      </div>
    </div>
  );
}
