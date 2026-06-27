import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { initObservability } from './observability'

// Initialise Sentry / PostHog / Clarity before React mounts so error
// boundaries + page-view auto-capture see the very first render.
// Each SDK silently no-ops when its env var is missing.
initObservability()

// Default staleTime=0 (opt-in to caching, not opt-out) — field ops data
// must be fresh by default. Pages that explicitly want caching set their
// own staleTime on the individual query.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
