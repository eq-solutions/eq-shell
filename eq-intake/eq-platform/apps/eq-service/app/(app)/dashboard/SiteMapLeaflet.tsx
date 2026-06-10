'use client'

import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

export interface MapSite {
  id: string
  name: string
  state: string | null
  city: string | null
  latitude: number | null
  longitude: number | null
  customer_name: string | null
  asset_count: number
}

interface SiteMapLeafletProps {
  sites: MapSite[]
}

// Theme-matched marker colour
const PIN_COLOUR = '#3DA8D8' // eq-sky
const PIN_COLOUR_DEEP = '#2986B4' // eq-deep

function createPinIcon(count: number, isCluster = false) {
  const size = isCluster ? 40 : 30
  const bg = isCluster ? PIN_COLOUR_DEEP : PIN_COLOUR
  return L.divIcon({
    className: 'custom-pin',
    html: `<div style="
      width:${size}px;height:${size}px;
      background:${bg};
      border:3px solid white;
      border-radius:50%;
      display:flex;align-items:center;justify-content:center;
      color:white;font-weight:700;font-size:${isCluster ? 14 : 12}px;
      box-shadow:0 2px 8px rgba(0,0,0,0.25);
      font-family:system-ui,sans-serif;
    ">${count}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

export function SiteMapLeaflet({ sites }: SiteMapLeafletProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstance = useRef<L.Map | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return

    const sitesWithCoords = sites.filter((s) => s.latitude && s.longitude)

    // Default to Australia centre
    const defaultCenter: L.LatLngExpression = [-28.0, 134.0]
    const defaultZoom = 4

    const map = L.map(mapRef.current, {
      center: defaultCenter,
      zoom: defaultZoom,
      zoomControl: true,
      scrollWheelZoom: true,
      attributionControl: false,
    })

    // Use CartoDB Positron (clean, light, no API key needed)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 18,
      subdomains: 'abcd',
    }).addTo(map)

    // Small attribution in corner
    L.control.attribution({ position: 'bottomright', prefix: false }).addTo(map)

    // Add markers
    const markers: L.Marker[] = []

    for (const site of sitesWithCoords) {
      const marker = L.marker([site.latitude!, site.longitude!], {
        icon: createPinIcon(site.asset_count || 1),
      })

      // Tooltip on hover
      const tooltipContent = `
        <div style="font-family:system-ui,sans-serif;min-width:140px;">
          <div style="font-weight:700;font-size:13px;color:#1A1A2E;margin-bottom:2px;">${site.name}</div>
          ${site.customer_name ? `<div style="font-size:11px;color:#6B7280;">${site.customer_name}</div>` : ''}
          ${site.city || site.state ? `<div style="font-size:11px;color:#6B7280;">${[site.city, site.state].filter(Boolean).join(', ')}</div>` : ''}
          ${site.asset_count > 0 ? `<div style="font-size:11px;color:#3DA8D8;font-weight:600;margin-top:3px;">${site.asset_count} assets</div>` : ''}
        </div>
      `
      marker.bindTooltip(tooltipContent, {
        direction: 'top',
        offset: [0, -18],
        className: 'site-tooltip',
      })

      marker.addTo(map)
      markers.push(marker)
    }

    // Fit bounds to show all sites with padding
    if (markers.length > 0) {
      const group = L.featureGroup(markers)
      map.fitBounds(group.getBounds().pad(0.15), { maxZoom: 12 })
    }

    mapInstance.current = map
    setReady(true)

    return () => {
      map.remove()
      mapInstance.current = null
    }
  }, [sites])

  const sitesWithCoords = sites.filter((s) => s.latitude && s.longitude)
  const sitesWithoutCoords = sites.length - sitesWithCoords.length

  return (
    <div className="relative z-0">
      <div ref={mapRef} className="w-full h-[380px] rounded-xl overflow-hidden border border-gray-200 z-0" />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-50 rounded-xl">
          <p className="text-sm text-eq-grey">Loading map...</p>
        </div>
      )}
      {sitesWithoutCoords > 0 && (
        <p className="text-[11px] text-eq-grey mt-2">
          {sitesWithoutCoords} {sitesWithoutCoords === 1 ? 'site has' : 'sites have'} no coordinates set — add lat/lng in site settings to show on map.
        </p>
      )}
      {/* Override leaflet tooltip styling */}
      <style dangerouslySetInnerHTML={{ __html: `
        .site-tooltip {
          border: 1px solid #E5E7EB !important;
          border-radius: 8px !important;
          box-shadow: 0 4px 12px rgba(0,0,0,0.12) !important;
          padding: 8px 10px !important;
        }
        .site-tooltip::before {
          border-top-color: #E5E7EB !important;
        }
        .leaflet-container {
          font-family: system-ui, -apple-system, sans-serif;
          z-index: 0 !important;
        }
        .leaflet-pane,
        .leaflet-control-container {
          z-index: 0 !important;
        }
      ` }} />
    </div>
  )
}
