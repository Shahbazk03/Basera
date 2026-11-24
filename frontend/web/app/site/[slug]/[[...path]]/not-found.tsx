import { Button } from '@estate/ui';

/**
 * 404 inside a project microsite (e.g. an old URL on a custom domain that now points here).
 * Links only to the microsite home: marketplace routes do not exist on project domains.
 */
export default function MicrositeNotFound() {
  return (
    <div className="grid min-h-dvh place-items-center bg-canvas px-6">
      <div className="max-w-md text-center">
        <p className="tabular font-display text-[64px] font-extrabold leading-none text-ink-200">404</p>
        <h1 className="mt-4 text-[24px] font-bold text-ink-900">This page does not exist</h1>
        <p className="mt-2 text-[15px] text-ink-500">The link may be outdated. Everything about this project is on its home page.</p>
        <div className="mt-6 flex justify-center">
          <Button asChild>
            <a href="/">Go to the project home</a>
          </Button>
        </div>
      </div>
    </div>
  );
}
