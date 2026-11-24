import Link from 'next/link';
import { Button } from '@estate/ui';

export default function NotFound() {
  return (
    <div className="grid min-h-[70vh] place-items-center bg-canvas px-6">
      <div className="max-w-md text-center">
        <p className="tabular font-display text-[64px] font-extrabold leading-none text-ink-200">404</p>
        <h1 className="mt-4 text-[24px] font-bold text-ink-900">We could not find that page</h1>
        <p className="mt-2 text-[15px] text-ink-500">The listing may have been removed, or the link may be incorrect.</p>
        <div className="mt-6 flex justify-center gap-3">
          <Button asChild>
            <Link href="/">Go to the homepage</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/buy">Browse properties</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
