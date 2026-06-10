import { createClient } from '@/lib/supabase/server'
import { Breadcrumb } from '@/components/ui/Breadcrumb'
import { MediaLibraryClient } from './MediaLibraryClient'

export const dynamic = 'force-dynamic'

export default async function MediaLibraryPage() {
  const supabase = await createClient()

  // Fetch all active media items
  const { data: media } = await supabase
    .from('media_library')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false })

  // Fetch customers for entity association
  const { data: customers } = await supabase
    .from('customers')
    .select('id, name')
    .eq('is_active', true)
    .order('name')

  // Fetch sites for entity association
  const { data: sites } = await supabase
    .from('sites')
    .select('id, name')
    .eq('is_active', true)
    .order('name')

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[{ label: 'Home', href: '/dashboard' }, { label: 'Admin', href: '/admin' }, { label: 'Media Library' }]} />
        <h1 className="text-2xl font-bold text-eq-ink mt-2">Media Library</h1>
        <p className="text-sm text-eq-grey mt-1">
          Upload and manage images in one place. Reference them anywhere via dropdown — no duplicates.
        </p>
      </div>

      <MediaLibraryClient
        // media.surface comes back as string from the DB; MediaLibraryClient
        // narrows to MediaSurface enum at the consumer level. Cast bridges
        // the column-to-enum step at the route boundary.
        media={(media ?? []) as Parameters<typeof MediaLibraryClient>[0]['media']}
        customers={customers ?? []}
        sites={sites ?? []}
      />
    </div>
  )
}
