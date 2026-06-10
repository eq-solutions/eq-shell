-- Add latitude/longitude to sites for interactive map
ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS latitude double precision DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS longitude double precision DEFAULT NULL;

COMMENT ON COLUMN public.sites.latitude IS 'GPS latitude for map pin placement';
COMMENT ON COLUMN public.sites.longitude IS 'GPS longitude for map pin placement';

-- Seed known Equinix Sydney data centre coordinates
-- SY1: 47 Bourke Rd, Alexandria
UPDATE public.sites SET latitude = -33.9050, longitude = 151.1930 WHERE name ILIKE '%SY1%' AND latitude IS NULL;
-- SY2: 1 Huntley St, Alexandria
UPDATE public.sites SET latitude = -33.9070, longitude = 151.1955 WHERE name ILIKE '%SY2%' AND latitude IS NULL;
-- SY3: 49 Bourke Rd, Alexandria
UPDATE public.sites SET latitude = -33.9055, longitude = 151.1935 WHERE name ILIKE '%SY3%' AND latitude IS NULL;
-- SY4: 17 Bourke Rd, Alexandria
UPDATE public.sites SET latitude = -33.9035, longitude = 151.1920 WHERE name ILIKE '%SY4%' AND latitude IS NULL;
-- SY5: Erskine Park
UPDATE public.sites SET latitude = -33.8125, longitude = 150.7920 WHERE name ILIKE '%SY5%' AND latitude IS NULL;
-- SY6: 6 Eden Park Dr, Macquarie Park
UPDATE public.sites SET latitude = -33.7780, longitude = 151.1290 WHERE name ILIKE '%SY6%' AND latitude IS NULL;
-- ME1: 826 Port Rd, Woodville
UPDATE public.sites SET latitude = -34.8780, longitude = 138.5390 WHERE name ILIKE '%ME1%' AND latitude IS NULL;
-- ML2: 100 Dorcas St, South Melbourne
UPDATE public.sites SET latitude = -37.8330, longitude = 144.9640 WHERE name ILIKE '%ML2%' AND latitude IS NULL;
-- PE1: 60 Randell St, Perth
UPDATE public.sites SET latitude = -31.9460, longitude = 115.8610 WHERE name ILIKE '%PE1%' AND latitude IS NULL;
-- BR1: Brisbane
UPDATE public.sites SET latitude = -27.4475, longitude = 153.0140 WHERE name ILIKE '%BR1%' AND latitude IS NULL;
-- CB1: Canberra
UPDATE public.sites SET latitude = -35.3075, longitude = 149.1245 WHERE name ILIKE '%CB1%' AND latitude IS NULL;
-- AD1: Adelaide
UPDATE public.sites SET latitude = -34.9285, longitude = 138.6005 WHERE name ILIKE '%AD1%' AND latitude IS NULL;
