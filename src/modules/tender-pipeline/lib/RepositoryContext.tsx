// RepositoryContext — injects the TenderRepository implementation
// into every page in the module. The module root binds a concrete
// implementation (today: MockTenderRepository); pages read it via
// useTenderRepository().
//
// Swapping to a real Supabase-backed repo later is one-line —
// change the value passed to the provider in `index.tsx`.

// eslint-disable react-refresh/only-export-components — co-locating the
// hook with the provider is a common React pattern; the fast-refresh
// boundary cost is acceptable here (matches the precedent set by
// Phase 1.B's `src/brand.tsx`).

/* eslint-disable react-refresh/only-export-components */

import { createContext, useContext, type ReactNode } from 'react';
import type { TenderRepository } from './repository';

const RepositoryContext = createContext<TenderRepository | null>(null);

export function RepositoryProvider({
  repository,
  children,
}: {
  repository: TenderRepository;
  children: ReactNode;
}) {
  return <RepositoryContext.Provider value={repository}>{children}</RepositoryContext.Provider>;
}

export function useTenderRepository(): TenderRepository {
  const repo = useContext(RepositoryContext);
  if (!repo) {
    throw new Error('useTenderRepository must be used inside <RepositoryProvider>');
  }
  return repo;
}
