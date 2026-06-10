-- ============================================================
-- Migration 0095: Atomic RCD test save (header + circuits)
-- ============================================================
--
-- PURPOSE
-- -------
-- Audit issue #103 — when a technician hits "Save & mark complete" on
-- the RCD test editor (/testing/rcd/[id]), the client previously
-- fired two server actions in sequence:
--
--   1. updateRcdCircuitsAction       — writes per-circuit timing rows
--   2. updateRcdTestHeaderAction     — flips status to 'complete' and
--                                       runs propagateCheckCompletionIfReady
--
-- If step 2 failed (RLS edge case, propagation error, network blip)
-- step 1 was already committed. The test was left half-applied:
-- circuits saved, but the header status still 'draft'. AS/NZS 3760
-- compliance evidence requires atomic state — an auditor seeing the
-- partial state would (rightly) question integrity.
--
-- This migration provides a single SECURITY INVOKER function that
-- performs both writes in one transaction. plpgsql function bodies
-- run inside an implicit BEGIN…COMMIT, so any RAISE EXCEPTION
-- rolls the whole thing back. Matches the pattern already in
-- migration 0083 (wipe_and_replace_contract_scopes).
--
-- RLS
-- ---
-- SECURITY INVOKER so all rcd_tests / rcd_test_circuits policies
-- still apply — the function isn't an authorisation bypass, just
-- an atomicity primitive. Cross-test circuit IDs are rejected
-- explicitly inside the function (defence in depth on top of the
-- ownership check the JS-side action already performs).
-- ============================================================

CREATE OR REPLACE FUNCTION public.rcd_test_save_complete(
  p_test_id      uuid,
  p_header       jsonb,   -- header columns to update (any subset)
  p_circuits     jsonb,   -- array of circuit patch objects, each must include {id, ...patch}
  p_mark_complete boolean  -- when true, set status='complete' regardless of header payload
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_check_id        uuid;
  v_prev_status     text;
  v_updated_count   integer := 0;
  v_circuit         jsonb;
  v_circuit_id      uuid;
  v_stranger_count  integer := 0;
  v_test_exists     boolean;
BEGIN
  -- 1. Load + ownership check on the rcd_test. RLS will already
  --    block tenants from seeing rows that aren't theirs; this
  --    SELECT is just so we can capture check_id + prior status
  --    for the propagation logic.
  SELECT check_id, status
    INTO v_check_id, v_prev_status
    FROM public.rcd_tests
   WHERE id = p_test_id
     AND is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RCD test % not found or not active', p_test_id
      USING ERRCODE = '42704';
  END IF;

  -- 2. Validate every circuit in the payload belongs to this test.
  --    Defence in depth — the JS-side action also checks this, but
  --    a tampered payload reaching the RPC directly would otherwise
  --    fall through to RLS (which would let cross-tenant attempts
  --    fail loudly but would silently allow cross-test-within-tenant).
  IF p_circuits IS NOT NULL AND jsonb_typeof(p_circuits) = 'array' THEN
    SELECT count(*)
      INTO v_stranger_count
      FROM jsonb_array_elements(p_circuits) AS c
     WHERE NOT EXISTS (
       SELECT 1
         FROM public.rcd_test_circuits rtc
        WHERE rtc.id = (c->>'id')::uuid
          AND rtc.rcd_test_id = p_test_id
     );

    IF v_stranger_count > 0 THEN
      RAISE EXCEPTION 'One or more circuits do not belong to this test'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 3. Update each circuit row. Only writes columns present in the
  --    patch object. NULL is a valid value for the timing fields
  --    (blank = not tested), so we distinguish "key missing" from
  --    "key present with null" using `?` (key existence test).
  IF p_circuits IS NOT NULL AND jsonb_typeof(p_circuits) = 'array' THEN
    FOR v_circuit IN SELECT * FROM jsonb_array_elements(p_circuits)
    LOOP
      v_circuit_id := (v_circuit->>'id')::uuid;

      UPDATE public.rcd_test_circuits SET
        x1_no_trip_0_ms     = CASE WHEN v_circuit ? 'x1_no_trip_0_ms'     THEN v_circuit->>'x1_no_trip_0_ms'     ELSE x1_no_trip_0_ms     END,
        x1_no_trip_180_ms   = CASE WHEN v_circuit ? 'x1_no_trip_180_ms'   THEN v_circuit->>'x1_no_trip_180_ms'   ELSE x1_no_trip_180_ms   END,
        x1_trip_0_ms        = CASE WHEN v_circuit ? 'x1_trip_0_ms'        THEN v_circuit->>'x1_trip_0_ms'        ELSE x1_trip_0_ms        END,
        x1_trip_180_ms      = CASE WHEN v_circuit ? 'x1_trip_180_ms'      THEN v_circuit->>'x1_trip_180_ms'      ELSE x1_trip_180_ms      END,
        x5_fast_0_ms        = CASE WHEN v_circuit ? 'x5_fast_0_ms'        THEN v_circuit->>'x5_fast_0_ms'        ELSE x5_fast_0_ms        END,
        x5_fast_180_ms      = CASE WHEN v_circuit ? 'x5_fast_180_ms'      THEN v_circuit->>'x5_fast_180_ms'      ELSE x5_fast_180_ms      END,
        trip_test_button_ok = CASE WHEN v_circuit ? 'trip_test_button_ok' THEN (v_circuit->>'trip_test_button_ok')::boolean ELSE trip_test_button_ok END,
        action_taken        = CASE WHEN v_circuit ? 'action_taken'        THEN v_circuit->>'action_taken'        ELSE action_taken        END,
        is_critical_load    = CASE WHEN v_circuit ? 'is_critical_load'    THEN (v_circuit->>'is_critical_load')::boolean   ELSE is_critical_load    END
      WHERE id = v_circuit_id
        AND rcd_test_id = p_test_id;

      v_updated_count := v_updated_count + 1;
    END LOOP;
  END IF;

  -- 4. Update the header. As with circuits, only writes columns
  --    present in the patch object — supports partial updates.
  UPDATE public.rcd_tests SET
    technician_name_snapshot = CASE WHEN p_header ? 'technician_name_snapshot' THEN p_header->>'technician_name_snapshot' ELSE technician_name_snapshot END,
    technician_initials      = CASE WHEN p_header ? 'technician_initials'      THEN p_header->>'technician_initials'      ELSE technician_initials      END,
    site_rep_name            = CASE WHEN p_header ? 'site_rep_name'            THEN p_header->>'site_rep_name'            ELSE site_rep_name            END,
    equipment_used           = CASE WHEN p_header ? 'equipment_used'           THEN p_header->>'equipment_used'           ELSE equipment_used           END,
    notes                    = CASE WHEN p_header ? 'notes'                    THEN p_header->>'notes'                    ELSE notes                    END,
    status                   = CASE
                                  WHEN p_mark_complete THEN 'complete'
                                  WHEN p_header ? 'status' THEN p_header->>'status'
                                  ELSE status
                                END
  WHERE id = p_test_id;

  -- 5. Return enough for the calling action to drive its
  --    post-commit work (audit logging, propagation, revalidation).
  RETURN jsonb_build_object(
    'check_id',      v_check_id,
    'prev_status',   v_prev_status,
    'updated_count', v_updated_count,
    'going_to_complete',
      CASE WHEN p_mark_complete AND v_prev_status IS DISTINCT FROM 'complete'
           THEN true ELSE false END
  );
END;
$$;

COMMENT ON FUNCTION public.rcd_test_save_complete IS
  'Atomic save of an RCD test header + per-circuit timing values in one transaction. Used by the onsite editor''s Save & mark complete path so a half-applied state (circuits saved, header still draft) is impossible. SECURITY INVOKER — RLS on rcd_tests / rcd_test_circuits still applies. Propagation to the parent maintenance_check happens in the JS layer after the RPC returns (read-mostly query that benefits from the Supabase client''s connection rather than nested function calls inside a transaction).';

-- Permissions: only authenticated users with writer roles (which RLS
-- already enforces); revoke from anon to be explicit.
REVOKE EXECUTE ON FUNCTION public.rcd_test_save_complete(uuid, jsonb, jsonb, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rcd_test_save_complete(uuid, jsonb, jsonb, boolean) TO authenticated;
