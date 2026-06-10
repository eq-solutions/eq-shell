-- 0034: Add photo_url to sites for media library integration
-- Allows sites to have a photo (e.g. building exterior) selected from the media library.

ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS photo_url text;

COMMENT ON COLUMN public.sites.photo_url IS 'URL to site photo from media library';
