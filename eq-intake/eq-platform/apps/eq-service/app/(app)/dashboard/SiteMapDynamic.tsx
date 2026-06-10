'use client'

import dynamic from 'next/dynamic'
import type { MapSite } from './SiteMapLeaflet'

const SiteMapLeaflet = dynamic(() => import('./SiteMapLeaflet').then((m) => m.SiteMapLeaflet), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[380px] rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-center">
      <p className="text-sm text-eq-grey">Loading map...</p>
    </div>
  ),
})

interface SiteMapDynamicProps {
  sites: MapSite[]
}

export function SiteMapDynamic({ sites }: SiteMapDynamicProps) {
  return <SiteMapLeaflet sites={sites} />
}
