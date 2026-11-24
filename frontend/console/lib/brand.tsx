'use client';

import * as React from 'react';

/** Brand name from the platform settings (Admin → Settings → Brand), resolved on the server by the root layout. */
const BrandContext = React.createContext<string>('Console');

export function BrandProvider({ name, children }: { name: string; children: React.ReactNode }) {
  return <BrandContext.Provider value={name}>{children}</BrandContext.Provider>;
}

export function useBrandName(): string {
  return React.useContext(BrandContext);
}
