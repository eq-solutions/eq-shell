// BrandProvider — Q6 lock from EQ-SHELL-DESIGN.md.
//
// Shell fetches the tenant brand on mount (via the session) and
// holds it in React Context. The brand colour is also written to
// the `--eq-brand` CSS custom property at the document root so any
// stylesheet (including future module CSS modules) can pick it up
// without prop-drilling.
//
// For the EQ Field iframe handoff, the brand is conveyed via the
// URL hash (see Phase 1.C). Phase 1.B passes only the auth token —
// the brand piece of Q6 lands when Phase 2 needs to skin Field.

import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import type { Tenant } from './session';

export interface Brand {
  color: string;
  logoUrl: string | null;
  name: string;
}

const DEFAULT_BRAND: Brand = {
  color: '#3DA8D8', // EQ sky blue — fallback if tenant has no brand_color set
  logoUrl: null,
  name: 'EQ',
};

const BrandContext = createContext<Brand>(DEFAULT_BRAND);

export function BrandProvider({
  tenant,
  children,
}: {
  tenant: Tenant | null | undefined;
  children: ReactNode;
}) {
  const brand: Brand = useMemo(
    () =>
      tenant
        ? {
            color: tenant.brand_color || DEFAULT_BRAND.color,
            logoUrl: tenant.brand_logo_url,
            name: tenant.name,
          }
        : DEFAULT_BRAND,
    [tenant],
  );

  // Mirror brand colour into a CSS custom property so vanilla CSS
  // (and future iframe-bridged modules) can read it.
  useEffect(() => {
    document.documentElement.style.setProperty('--eq-brand', brand.color);
  }, [brand.color]);

  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>;
}

export function useBrand(): Brand {
  return useContext(BrandContext);
}
