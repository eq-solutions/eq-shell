import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initObservability } from './observability'

// Initialise Sentry / PostHog / Clarity before React mounts so error
// boundaries + page-view auto-capture see the very first render.
// Each SDK silently no-ops when its env var is missing.
initObservability()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
