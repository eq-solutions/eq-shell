-- Migration 0056: Multi-category tagging on media_library
-- A single media asset (e.g. the SKS White logo) can now belong to multiple
-- categories — app banner AND report image — without duplicate uploads.
--
-- Legacy `category` column is kept as a mirror of categories[0] for the life
-- of this migration so in-flight sessions don't error. Drop in a follow-up.

-- 1. Add the new array column
alter table public.media_library
  add column if not exists categories text[] not null default '{}';

-- 2. Backfill from the existing single-valued column
update public.media_library
set categories = array[category]
where categories = '{}'::text[]
  and category is not null;

-- 3. Enforce allowed values on every element of the array
alter table public.media_library
  drop constraint if exists media_library_categories_valid;

alter table public.media_library
  add constraint media_library_categories_valid
  check (
    array_length(categories, 1) >= 1
    and categories <@ array['customer_logo', 'site_photo', 'report_image', 'general']::text[]
  );

-- 4. GIN index for @> / && array-containment lookups
create index if not exists idx_media_library_categories_gin
  on public.media_library using gin (categories);

-- 5. Keep the legacy per-tenant category index for the single-value code path
--    (already created in 0033 — no-op here, just documenting we're keeping it).

-- 6. Trigger: keep `category` in sync with categories[0] on write.
--    This lets the old column remain a useful denormalised display field
--    until we drop it in a later migration.
create or replace function public.sync_media_library_category()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.categories is not null and array_length(new.categories, 1) >= 1 then
    new.category := new.categories[1];
  end if;
  return new;
end;
$$;

drop trigger if exists trg_media_library_category_sync on public.media_library;
create trigger trg_media_library_category_sync
  before insert or update of categories on public.media_library
  for each row execute function public.sync_media_library_category();

comment on column public.media_library.categories is
  'Array of categories this media belongs to. Primary slot is categories[1] — mirrored to legacy category column via trg_media_library_category_sync.';
