'use client'

import { useState } from 'react'

interface StateData {
  count: number
  sites: string[]
}

interface AuSiteMapProps {
  stateData: Record<string, StateData>
}

// Pin positions calibrated to the SVG viewBox (0 0 400 380)
const STATE_POSITIONS: Record<string, { x: number; y: number; label: string }> = {
  WA:  { x: 90,  y: 175, label: 'WA' },
  NT:  { x: 185, y: 100, label: 'NT' },
  SA:  { x: 210, y: 225, label: 'SA' },
  QLD: { x: 310, y: 130, label: 'QLD' },
  NSW: { x: 320, y: 235, label: 'NSW' },
  ACT: { x: 325, y: 255, label: 'ACT' },
  VIC: { x: 290, y: 280, label: 'VIC' },
  TAS: { x: 295, y: 340, label: 'TAS' },
}

// Simplified but recognisable Australia outline
const AU_MAINLAND = "M130,55 L140,50 L155,48 L168,50 L180,45 L195,42 L210,45 L225,40 L240,38 L260,42 L275,48 L290,55 L305,52 L315,58 L325,55 L340,60 L350,68 L355,80 L350,92 L355,105 L360,115 L365,130 L360,145 L355,155 L360,170 L365,185 L360,195 L350,205 L345,218 L340,228 L330,238 L322,248 L315,258 L305,265 L295,272 L285,278 L275,282 L260,285 L248,280 L240,275 L230,278 L218,282 L205,278 L195,272 L185,265 L175,258 L165,255 L155,260 L145,265 L132,270 L120,268 L108,262 L98,255 L88,248 L78,238 L70,225 L62,210 L55,195 L50,178 L48,160 L50,142 L55,128 L60,115 L58,102 L62,90 L70,78 L80,68 L92,62 L105,58 L118,55 Z"
const AU_TASMANIA = "M278,315 L290,310 L305,312 L315,320 L312,332 L305,340 L292,342 L280,338 L275,328 L278,315 Z"
// Cape York peninsula detail
const AU_CAPE_YORK = "M315,58 L318,45 L325,35 L335,28 L340,35 L338,48 L340,60 Z"
// Gulf of Carpentaria indent
const AU_GULF = "M225,40 L220,52 L215,60 L210,65 L205,60 L200,52 L195,42 Z"

export function AuSiteMap({ stateData }: AuSiteMapProps) {
  const [hoveredState, setHoveredState] = useState<string | null>(null)

  const totalSites = Object.values(stateData).reduce((sum, d) => sum + d.count, 0)

  // Filter out "Unknown" from the legend display — these are sites with no state set
  const knownStates = Object.entries(stateData).filter(([state]) => state !== 'Unknown')
  const unknownCount = stateData['Unknown']?.count ?? 0

  return (
    <div className="flex gap-6 items-start">
      {/* Map area */}
      <div className="relative w-full max-w-lg aspect-[4/3.5] bg-gradient-to-b from-sky-50/50 to-blue-50/50 rounded-xl overflow-hidden border border-sky-100">
        <svg viewBox="0 0 400 380" className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg">
          {/* Water background pattern */}
          <defs>
            <radialGradient id="waterGrad" cx="50%" cy="50%" r="60%">
              <stop offset="0%" stopColor="#F0F9FF" />
              <stop offset="100%" stopColor="#E0F2FE" />
            </radialGradient>
          </defs>
          <rect width="400" height="380" fill="url(#waterGrad)" />

          {/* Mainland */}
          <path d={AU_MAINLAND} fill="#E0F2FE" stroke="#93C5FD" strokeWidth="1.2" strokeLinejoin="round" />
          {/* Cape York */}
          <path d={AU_CAPE_YORK} fill="#E0F2FE" stroke="#93C5FD" strokeWidth="1.2" strokeLinejoin="round" />
          {/* Gulf indent (water) */}
          <path d={AU_GULF} fill="url(#waterGrad)" stroke="#93C5FD" strokeWidth="0.8" strokeLinejoin="round" />
          {/* Tasmania */}
          <path d={AU_TASMANIA} fill="#E0F2FE" stroke="#93C5FD" strokeWidth="1.2" strokeLinejoin="round" />

          {/* State border hints (subtle dashed lines) */}
          {/* SA-NSW border */}
          <line x1="258" y1="175" x2="258" y2="282" stroke="#93C5FD" strokeWidth="0.4" strokeDasharray="4,4" />
          {/* NSW-QLD border */}
          <line x1="258" y1="175" x2="365" y2="175" stroke="#93C5FD" strokeWidth="0.4" strokeDasharray="4,4" />
          {/* SA-NT border */}
          <line x1="175" y1="170" x2="258" y2="170" stroke="#93C5FD" strokeWidth="0.4" strokeDasharray="4,4" />
          {/* WA-NT/SA border */}
          <line x1="175" y1="42" x2="175" y2="282" stroke="#93C5FD" strokeWidth="0.4" strokeDasharray="4,4" />
          {/* VIC-NSW border approx */}
          <line x1="258" y1="268" x2="322" y2="248" stroke="#93C5FD" strokeWidth="0.4" strokeDasharray="4,4" />

          {/* State labels (faint) */}
          <text x="90" y="185" fill="#93C5FD" fontSize="12" fontWeight="600" textAnchor="middle" opacity="0.5">WA</text>
          <text x="185" y="115" fill="#93C5FD" fontSize="12" fontWeight="600" textAnchor="middle" opacity="0.5">NT</text>
          <text x="215" y="235" fill="#93C5FD" fontSize="11" fontWeight="600" textAnchor="middle" opacity="0.5">SA</text>
          <text x="310" y="145" fill="#93C5FD" fontSize="12" fontWeight="600" textAnchor="middle" opacity="0.5">QLD</text>
          <text x="310" y="215" fill="#93C5FD" fontSize="11" fontWeight="600" textAnchor="middle" opacity="0.5">NSW</text>
          <text x="280" y="290" fill="#93C5FD" fontSize="10" fontWeight="600" textAnchor="middle" opacity="0.5">VIC</text>
          <text x="295" y="350" fill="#93C5FD" fontSize="9" fontWeight="600" textAnchor="middle" opacity="0.5">TAS</text>
        </svg>

        {/* State pins */}
        {Object.entries(STATE_POSITIONS).map(([state, pos]) => {
          const data = stateData[state]
          if (!data || data.count === 0) return null

          const isHovered = hoveredState === state
          // Scale pin: base 24px, +4 per site, max 44
          const size = Math.min(24 + data.count * 4, 44)

          return (
            <div
              key={state}
              className="absolute transform -translate-x-1/2 -translate-y-1/2 cursor-pointer transition-all duration-200 z-10"
              style={{ left: `${(pos.x / 400) * 100}%`, top: `${(pos.y / 380) * 100}%` }}
              onMouseEnter={() => setHoveredState(state)}
              onMouseLeave={() => setHoveredState(null)}
            >
              {/* Pulse ring for hovered */}
              {isHovered && (
                <div
                  className="absolute rounded-full bg-eq-sky/20 animate-ping"
                  style={{ width: size + 16, height: size + 16, left: -(size + 16) / 2 + size / 2, top: -(size + 16) / 2 + size / 2 }}
                />
              )}
              <div
                className={`rounded-full flex items-center justify-center font-bold text-white shadow-lg transition-all duration-200 border-2 border-white ${isHovered ? 'bg-eq-deep scale-110' : 'bg-eq-sky'}`}
                style={{ width: size, height: size, fontSize: Math.max(10, size * 0.38) }}
              >
                {data.count}
              </div>

              {/* Tooltip */}
              {isHovered && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 bg-white border border-gray-200 rounded-lg shadow-xl p-3 min-w-[160px] z-20">
                  <p className="text-xs font-bold text-eq-ink mb-1.5">{pos.label} — {data.count} {data.count === 1 ? 'site' : 'sites'}</p>
                  <div className="space-y-1">
                    {data.sites.slice(0, 8).map(name => (
                      <p key={name} className="text-[11px] text-eq-grey truncate">{name}</p>
                    ))}
                    {data.sites.length > 8 && (
                      <p className="text-[11px] text-eq-sky font-medium">+{data.sites.length - 8} more</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* State legend / summary */}
      <div className="flex-1 min-w-[180px]">
        <p className="text-xs font-bold text-eq-grey uppercase tracking-wide mb-3">
          {totalSites} {totalSites === 1 ? 'Site' : 'Sites'} Active
        </p>
        <div className="space-y-1.5">
          {knownStates
            .sort(([, a], [, b]) => b.count - a.count)
            .map(([state, data]) => (
              <div
                key={state}
                className={`flex items-center justify-between px-3 py-2 rounded-lg transition-colors cursor-default ${hoveredState === state ? 'bg-eq-ice' : 'hover:bg-gray-50'}`}
                onMouseEnter={() => setHoveredState(state)}
                onMouseLeave={() => setHoveredState(null)}
              >
                <div className="flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-full transition-colors ${hoveredState === state ? 'bg-eq-deep' : 'bg-eq-sky'}`} />
                  <span className="text-sm text-eq-ink font-medium">{STATE_POSITIONS[state]?.label ?? state}</span>
                </div>
                <span className="text-sm font-bold text-eq-ink">{data.count}</span>
              </div>
            ))}
          {unknownCount > 0 && (
            <div className="flex items-center justify-between px-3 py-2 rounded-lg">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-gray-300" />
                <span className="text-sm text-eq-grey">No state set</span>
              </div>
              <span className="text-sm font-bold text-eq-grey">{unknownCount}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
