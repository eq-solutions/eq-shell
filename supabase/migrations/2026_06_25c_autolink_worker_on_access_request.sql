-- When a worker submits an org access request via EQ Cards, auto-link their
-- Supabase auth user to any existing workers record that has the same phone
-- but no user_id set yet.  Without this, workers who signed up via phone OTP
-- but were never explicitly invited show up as unnamed in the Staff page pending
-- list because the workerMap lookup by user_id finds nothing.
--
-- Only links when user_id IS NULL to avoid overwriting deliberate assignments.

CREATE OR REPLACE FUNCTION public.eq_cards_submit_access_request(
  p_org_id       uuid,
  p_sharing_scope text DEFAULT 'full'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone      text;
  v_request_id uuid;
BEGIN
  IF p_sharing_scope NOT IN ('basic', 'full') THEN
    RAISE EXCEPTION 'invalid_sharing_scope' USING ERRCODE = 'P0020';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.organisations
    WHERE id = p_org_id AND accepts_applications = true
  ) THEN
    RAISE EXCEPTION 'org_not_discoverable' USING ERRCODE = 'P0021';
  END IF;

  -- Block duplicate pending request to the same org
  IF EXISTS (
    SELECT 1 FROM public.org_access_requests
    WHERE org_id       = p_org_id
      AND worker_user_id = auth.uid()
      AND requested_by   = auth.uid()
      AND status         = 'pending'
  ) THEN
    RAISE EXCEPTION 'duplicate_request' USING ERRCODE = 'P0022';
  END IF;

  SELECT regexp_replace(regexp_replace(COALESCE(phone, ''), '\s', '', 'g'), '^(\+61|61|0)', '')
    INTO v_phone FROM auth.users WHERE id = auth.uid();

  INSERT INTO public.org_access_requests
    (org_id, worker_phone, worker_user_id, status, requested_by, sharing_scope)
  VALUES
    (p_org_id, NULLIF(v_phone, ''), auth.uid(), 'pending', auth.uid(), p_sharing_scope)
  RETURNING id INTO v_request_id;

  -- Link any existing unlinked workers record that matches by phone.
  -- This covers workers created by an admin before the worker ever signed into Cards.
  IF v_phone IS NOT NULL AND v_phone <> '' THEN
    UPDATE public.workers
    SET user_id = auth.uid()
    WHERE user_id IS NULL
      AND regexp_replace(regexp_replace(COALESCE(phone, ''), '\s', '', 'g'), '^(\+61|61|0)', '') = v_phone;
  END IF;

  RETURN v_request_id;
END;
$$;
