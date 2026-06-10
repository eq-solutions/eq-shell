import { createClient } from '@/lib/supabase/server'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { SearchResults } from './SearchResults'

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const params = await searchParams
  const query = params.q?.trim() ?? ''

  if (!query) {
    return (
      <div className="space-y-6">
        <div>
          <Breadcrumb items={[{ label: 'Home', href: '/dashboard' }, { label: 'Search' }]} />
          <h1 className="text-3xl font-bold text-eq-sky mt-2">Search</h1>
        </div>
        <SearchResults query="" results={[]} />
      </div>
    )
  }

  const supabase = await createClient()
  const pattern = `%${query}%`

  // Search in parallel across multiple tables
  const [assetsRes, sitesRes, customersRes, acbRes, nsxRes, instrumentsRes] = await Promise.all([
    supabase
      .from('assets')
      .select('id, name, asset_type, serial_number, manufacturer')
      .or(`name.ilike.${pattern},serial_number.ilike.${pattern},manufacturer.ilike.${pattern}`)
      .eq('is_active', true)
      .limit(10),
    supabase
      .from('sites')
      .select('id, name, code, address, city')
      .or(`name.ilike.${pattern},code.ilike.${pattern},address.ilike.${pattern},city.ilike.${pattern}`)
      .eq('is_active', true)
      .limit(10),
    supabase
      .from('customers')
      .select('id, name, code, email')
      .or(`name.ilike.${pattern},code.ilike.${pattern},email.ilike.${pattern}`)
      .eq('is_active', true)
      .limit(10),
    // Sprint 1 schema unification (Refs #101): query both legacy
    // (cb_make / cb_model) and new (brand / breaker_type) columns so
    // breakers entered via either form path are findable. cb_serial is
    // shared between both surfaces — no new counterpart.
    supabase
      .from('acb_tests')
      .select('id, cb_make, cb_model, cb_serial, brand, breaker_type, assets(name)')
      .or(
        `cb_make.ilike.${pattern},cb_model.ilike.${pattern},cb_serial.ilike.${pattern},brand.ilike.${pattern},breaker_type.ilike.${pattern}`,
      )
      .eq('is_active', true)
      .limit(10),
    supabase
      .from('nsx_tests')
      .select('id, cb_make, cb_model, cb_serial, brand, breaker_type, assets(name)')
      .or(
        `cb_make.ilike.${pattern},cb_model.ilike.${pattern},cb_serial.ilike.${pattern},brand.ilike.${pattern},breaker_type.ilike.${pattern}`,
      )
      .eq('is_active', true)
      .limit(10),
    supabase
      .from('instruments')
      .select('id, name, instrument_type, make, model, serial_number')
      .or(`name.ilike.${pattern},make.ilike.${pattern},model.ilike.${pattern},serial_number.ilike.${pattern}`)
      .eq('is_active', true)
      .limit(10),
  ])

  interface SearchResult {
    type: string
    id: string
    title: string
    subtitle: string
    href: string
  }

  const results: SearchResult[] = []

  for (const asset of assetsRes.data ?? []) {
    results.push({
      type: 'Asset',
      id: asset.id,
      title: asset.name,
      subtitle: [asset.asset_type, asset.manufacturer, asset.serial_number].filter(Boolean).join(' · '),
      href: '/assets',
    })
  }

  for (const site of sitesRes.data ?? []) {
    results.push({
      type: 'Site',
      id: site.id,
      title: site.name,
      subtitle: [site.code, site.address, site.city].filter(Boolean).join(' · '),
      href: '/sites',
    })
  }

  for (const customer of customersRes.data ?? []) {
    results.push({
      type: 'Customer',
      id: customer.id,
      title: customer.name,
      subtitle: [customer.code, customer.email].filter(Boolean).join(' · '),
      href: '/customers',
    })
  }

  for (const acb of acbRes.data ?? []) {
    const assetName = ((acb.assets as unknown) as { name: string } | null)?.name ?? ''
    // Refs #101: prefer new columns, fall back to legacy.
    const make = (acb as { brand?: string | null }).brand ?? acb.cb_make
    const model = (acb as { breaker_type?: string | null }).breaker_type ?? acb.cb_model
    results.push({
      type: 'ACB Test',
      id: acb.id,
      title: assetName || 'ACB Test',
      subtitle: [make, model, acb.cb_serial].filter(Boolean).join(' · '),
      href: `/testing/acb/${acb.id}`,
    })
  }

  for (const nsx of nsxRes.data ?? []) {
    const assetName = ((nsx.assets as unknown) as { name: string } | null)?.name ?? ''
    // Refs #101: prefer new columns, fall back to legacy.
    const make = (nsx as { brand?: string | null }).brand ?? nsx.cb_make
    const model = (nsx as { breaker_type?: string | null }).breaker_type ?? nsx.cb_model
    results.push({
      type: 'NSX Test',
      id: nsx.id,
      title: assetName || 'NSX Test',
      subtitle: [make, model, nsx.cb_serial].filter(Boolean).join(' · '),
      href: `/testing/nsx/${nsx.id}`,
    })
  }

  for (const inst of instrumentsRes.data ?? []) {
    results.push({
      type: 'Instrument',
      id: inst.id,
      title: inst.name,
      subtitle: [inst.instrument_type, inst.make, inst.model, inst.serial_number].filter(Boolean).join(' · '),
      href: '/instruments',
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[{ label: 'Home', href: '/dashboard' }, { label: 'Search' }]} />
        <h1 className="text-3xl font-bold text-eq-sky mt-2">Search</h1>
      </div>
      <SearchResults query={query} results={results} />
    </div>
  )
}
