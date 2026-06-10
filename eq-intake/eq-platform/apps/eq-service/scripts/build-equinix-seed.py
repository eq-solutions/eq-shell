"""
One-shot builder for supabase/seeds/equinix-job-plans.sql.

Reads the saved MCP tool-results JSON containing the
string_agg'd job_plan_items INSERTs, plus a hard-coded list
of plan and alias INSERTs derived from a prior export of the
SKS tenant's global (customer_id NULL, site_id NULL) job plans.

Run once. The output file is checked into the repo; rebuild only
if the prod global plan/item set changes meaningfully.
"""
from __future__ import annotations
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
ITEMS_DUMP = Path(sys.argv[1]) if len(sys.argv) > 1 else None
OUT = REPO / "supabase" / "seeds" / "equinix-job-plans.sql"

HEADER = """\
-- supabase/seeds/equinix-job-plans.sql
--
-- Global Equinix / Maximo job plans for the SKS tenant.
--
-- 50 plans (E1.x / M14.x / M11.x / EVS / YCC / E-SCH-NSX / E-ABB-REF)
-- + 649 plan items + 1 source alias (delta:MVSWBD -> MVSWDB).
-- All rows are tenant-scoped to ccca00fc-cbc8-442e-9489-0f1f216ddca8
-- (SKS) and have customer_id = NULL, site_id = NULL (global).
--
-- These are the Maximo task lists Equinix gives SKS; the technician
-- ticks tasks against an asset's maintenance check. Recovery flow:
-- after a wipe, run this file via `psql -f` (or `supabase db reset
-- --linked` which auto-runs seeds) to restore the plan library
-- before replaying any Delta WO imports.
--
-- Idempotent: every INSERT carries ON CONFLICT (id) DO NOTHING so
-- re-running is safe.
--
-- Built from prod 2026-05-21 via scripts/build-equinix-seed.py.

BEGIN;

-- ── 50 job plans ─────────────────────────────────────────────────
"""

PLANS_SQL = """\
INSERT INTO public.job_plans (id, tenant_id, name, code, type, description, frequency, is_active, customer_id, site_id) VALUES ('d8cf6afa-f359-45d9-a386-344657f4b6a5', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'E1.29.2', '24VBTCHGR', '24v /48v Battery Charger', NULL, NULL, true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_plans (id, tenant_id, name, code, type, description, frequency, is_active, customer_id, site_id) VALUES ('e49a67d0-a46d-461b-8d6b-919539b81773', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'E1.8', 'ATS', 'ATS-Automatic Transfer Switches', NULL, NULL, true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_plans (id, tenant_id, name, code, type, description, frequency, is_active, customer_id, site_id) VALUES ('53b5821c-af7c-48a8-87ca-812b01a8d996', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'E1.20', 'CRBSDCT', 'Critical Load Bus Duct', NULL, NULL, true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_plans (id, tenant_id, name, code, type, description, frequency, is_active, customer_id, site_id) VALUES ('7888bb79-1a30-4b0e-ae91-14fe97f453bf', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'E1.20.1', 'CRBSDCTWRPP', 'Critical Load Bus Duct w/RPPs', NULL, NULL, true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_plans (id, tenant_id, name, code, type, description, frequency, is_active, customer_id, site_id) VALUES ('08a2f3f2-6a14-47bb-aca9-f9e823471389', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'E1.6', 'DCPLNT', 'DC Power and Distribution Systems', NULL, NULL, true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_plans (id, tenant_id, name, code, type, description, frequency, is_active, customer_id, site_id) VALUES ('ca8c643d-7c57-4f34-9483-f1068c46c6da', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'E1.6.1', 'DCPLNTBT', 'DC Power and Distribution Systems w/Batteries', NULL, NULL, true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_plans (id, tenant_id, name, code, type, description, frequency, is_active, customer_id, site_id) VALUES ('e9488a99-bd27-4637-9b93-f1bf13c7cb50', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'E1.11', 'DPMC', 'Battery Monitoring System', NULL, NULL, true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_plans (id, tenant_id, name, code, type, description, frequency, is_active, customer_id, site_id) VALUES ('911c6d36-ba0c-40fe-8168-c4336cdd365a', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'E1.37', 'ELGLV', 'Electrical Gloves Testing', NULL, NULL, true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_plans (id, tenant_id, name, code, type, description, frequency, is_active, customer_id, site_id) VALUES ('2038cc14-ae35-4854-9e2f-714c6444ac70', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'E1.23', 'EMRGBSDCT', 'Emergency Use-Bus Duct', NULL, NULL, true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_plans (id, tenant_id, name, code, type, description, frequency, is_active, customer_id, site_id) VALUES ('fbfd64d4-bca8-4e14-be58-3fcc25778042', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'M14.33.1', 'EQROT', 'Equipment Failure Rotation Test', NULL, NULL, true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_plans (id, tenant_id, name, code, type, description, frequency, is_active, customer_id, site_id) VALUES ('6ffa89dc-fe38-4760-b53b-60c3518b28c5', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'E1.36', 'ES', 'Earthing System', NULL, NULL, true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_plans (id, tenant_id, name, code, type, description, frequency, is_active, customer_id, site_id) VALUES ('2a6285ec-b61f-4229-8321-dde9f90835aa', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'M14.46', 'EVCS', 'Electric Vehicle Charging Station', NULL, NULL, true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_plans (id, tenant_id, name, code, type, description, frequency, is_active, customer_id, site_id) VALUES ('3c01c242-af9d-4166-87b7-1ba0bcfa6060', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'E1.39', 'FPTST', 'Fall of Potential Testing', NULL, NULL, true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_plans (id, tenant_id, name, code, type, description, frequency, is_active, customer_id, site_id) VALUES ('4b9b6831-4b9b-4860-9d87-fc27d9b22f11', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'EVS 6.6', 'HVS', 'Eaton Vacuum Starter', NULL, NULL, false, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_plans (id, tenant_id, name, code, type, description, frequency, is_active, customer_id, site_id) VALUES ('b719c555-17e3-4eb5-835a-d33c6984a1ed', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'YCC 3.3', 'HVS', 'York Centrifugal Chiller 3.3kv', NULL, NULL, false, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_plans (id, tenant_id, name, code, type, description, frequency, is_active, customer_id, site_id) VALUES ('d7f8d9b0-8872-48c1-ac3f-402907ad9a7f', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'E1.35', 'JBI', 'Junction Box Inspections', NULL, NULL, true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_plans (id, tenant_id, name, code, type, description, frequency, is_active, customer_id, site_id) VALUES ('20b3d100-e6e3-433c-a18f-19786ac105e2', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'M14.5', 'LB', 'Load banks', NULL, NULL, true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_plans (id, tenant_id, name, code, type, description, frequency, is_active, customer_id, site_id) VALUES ('07ae9c26-1570-4135-8773-9b5d75e6b170', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'M14.29', 'LCP', 'Lighting control panel', NULL, NULL, true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_plans (id, tenant_id, name, code, type, description, frequency, is_active, customer_id, site_id) VALUES ('e511bed9-16ef-493f-8f4c-9897296f5cf6', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'M14.2', 'LDELEV', 'Loading Dock Levelers', NULL, NULL, true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_plans (id, tenant_id, name, code, type, description, frequency, is_active, customer_id, site_id) VALUES ('4d2fff3f-65fc-45b0-8486-f87c69dbd339', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'M14.28', 'LIGHTING', 'Lighting maintenance', NULL, NULL, true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_plans (id, tenant_id, name, code, type, description, frequency, is_active, customer_id, site_id) VALUES ('2013a857-cf5d-45dc-93c3-74f848cd21fa', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'M10.13', 'LIGHTN', 'Emergency Back Up Lighting', NULL, NULL, true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_plans (id, tenant_id, name, code, type, description, frequency, is_active, customer_id, site_id) VALUES ('f7e9b929-2728-4973-973f-ec9f9757175a', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'M14.21', 'LTNLTNG-AGPRO', 'Lightning Protection - Vendor Performed', NULL, NULL, true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_plans (id, tenant_id, name, code, type, description, frequency, is_active, customer_id, site_id) VALUES ('287d4a9d-a949-4b5d-a245-b281f32ee527', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'E1.17', 'LTSWBD', 'MSB/HDP - Load Transferring Switchboard Maintenance', NULL, NULL, true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_plans (id, tenant_id, name, code, type, description, frequency, is_active, customer_id, site_id) VALUES ('09b028b9-68e3-4be2-aa0a-358d9fc368e9', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'E1.25', 'LVACB', 'Low Voltage Air Circuit Breaker (ACB)', NULL, NULL, true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_plans (id, tenant_id, name, code, type, description, frequency, is_active, customer_id, site_id) VALUES ('33ae67ce-dc00-4346-adf1-b2affa00a6e2', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'E1.16', 'LVPSWBD', 'LV Paralleling Switchgear Maintenance', NULL, NULL, true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_plans (id, tenant_id, name, code, type, description, frequency, is_active, customer_id, site_id) VALUES ('4937de24-bc5c-495d-9a6d-f8945cd3f3ca', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'E1.18.1', 'MVGIS', 'MV Switchboard Maintenance (GIS)', NULL, NULL, true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_plans (id, tenant_id, name, code, type, description, frequency, is_active, customer_id, site_id) VALUES ('ccb508a6-5848-4457-8bc7-5952bb7d5d99', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'E1.18', 'MVSWDB', 'MV Switchboard Maintenance', NULL, NULL, true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_plans (id, tenant_id, name, code, type, description, frequency, is_active, customer_id, site_id) VALUES ('a0bce51c-793b-4712-a19f-2a6166bf6c1e', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'E-SCH-NSX', 'NSX', 'Schneider NSX moulded case circuit breaker', NULL, NULL, true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_plans (id, tenant_id, name, code, type, description, frequency, is_active, customer_id, site_id) VALUES ('d3532a0d-4217-4d53-936d-dad4ebd1a1bf', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'E1.3', 'PDU', 'PDU - Power Distribution Units', NULL, NULL, true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_plans (id, tenant_id, name, code, type, description, frequency, is_active, customer_id, site_id) VALUES ('69b1121a-b3d1-41e3-966b-7b139cb83864', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'E1.3.1', 'PDUWRPP(B)', 'PDU with RPPs (BCM)', NULL, NULL, true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_plans (id, tenant_id, name, code, type, description, frequency, is_active, customer_id, site_id) VALUES ('b27b3087-b3b9-4644-ae37-64e473abd247', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'E1.3.2', 'PDUWRPP(NB)', 'PDU with RPPs (No BCM)', NULL, NULL, true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_plans (id, tenant_id, name, code, type, description, frequency, is_active, customer_id, site_id) VALUES ('7059ecb0-21b5-4e13-b73a-645169cd3304', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'E1.30', 'PFC', 'LV Power Factor Correction unit (PFC)', NULL, NULL, true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_plans (id, tenant_id, name, code, type, description, frequency, is_active, customer_id, site_id) VALUES ('1dd40b00-a341-46cc-9ab5-50265b1eb9f6', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'E1.15', 'PMM', 'PMM (Power Management Module)', NULL, NULL, true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_plans (id, tenant_id, name, code, type, description, frequency, is_active, customer_id, site_id) VALUES ('6557633d-e8a4-4dcc-90f6-a6c2d88a4095', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'E1.33', 'PTP', 'Comprehensive Utility Failure Test (aka Pull the Plug Test)', NULL, NULL, true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_plans (id, tenant_id, name, code, type, description, frequency, is_active, customer_id, site_id) VALUES ('81a57fe5-4526-45b8-8648-247dc013ba02', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'E1.20.2', 'RBLOCK', 'Reserve/Catcher Block Busduct', NULL, NULL, true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_plans (id, tenant_id, name, code, type, description, frequency, is_active, customer_id, site_id) VALUES ('7e7322f0-776d-41ee-8dde-15581230f245', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'E-ABB-REF', 'REF', 'ABB Earth Fault Relay', NULL, NULL, true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_plans (id, tenant_id, name, code, type, description, frequency, is_active, customer_id, site_id) VALUES ('a392a8b7-b536-4327-9d09-10eafdce1b33', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'E1.14', 'RPPBCM', 'Electrical Panel w/BCM', NULL, NULL, true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_plans (id, tenant_id, name, code, type, description, frequency, is_active, customer_id, site_id) VALUES ('8a0798b2-2e32-489c-a679-221b902ba1f1', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'E1.40', 'SCADA/PLC', 'Electrical SCADA/PLC Systems', NULL, NULL, true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_plans (id, tenant_id, name, code, type, description, frequency, is_active, customer_id, site_id) VALUES ('45f79b8d-e634-454f-9535-28d33e7aa445', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'E1.12', 'SJPNL1', 'CP Distribution Panel (RPP) w/o BCM or remote BCM', NULL, NULL, true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_plans (id, tenant_id, name, code, type, description, frequency, is_active, customer_id, site_id) VALUES ('f87f637e-910d-4316-9e4a-7ddb456cdb2a', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'E1.27', 'SLRPNL', 'Solar Panels', NULL, NULL, true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_plans (id, tenant_id, name, code, type, description, frequency, is_active, customer_id, site_id) VALUES ('5dfc0819-4591-4bde-b670-e3d4cc61acf2', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'E1.28', 'SLRPNLIN', 'Solar Panel Inverter', NULL, NULL, true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_plans (id, tenant_id, name, code, type, description, frequency, is_active, customer_id, site_id) VALUES ('65d91f97-2e72-42d5-b195-40e3736df7d8', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'M11.10', 'SUUPS', 'Single Use UPS', NULL, NULL, true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_plans (id, tenant_id, name, code, type, description, frequency, is_active, customer_id, site_id) VALUES ('d280ef7d-5d8b-46d3-8aa7-29dc8955cbc7', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'E1.9', 'SWBD', 'General LV Switchboard', NULL, NULL, true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_plans (id, tenant_id, name, code, type, description, frequency, is_active, customer_id, site_id) VALUES ('fd5e5a94-2ca3-47d1-86bf-97e0ea87dca3', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'E1.26', 'TRNOS', 'Transformer Oil Sample', NULL, NULL, true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_plans (id, tenant_id, name, code, type, description, frequency, is_active, customer_id, site_id) VALUES ('93796505-de77-4d66-bff8-59788fb0bd7a', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'E1.34', 'TVSS', 'TVSS', NULL, NULL, true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_plans (id, tenant_id, name, code, type, description, frequency, is_active, customer_id, site_id) VALUES ('9610918b-25bb-4b3e-aa8d-d474562b0a8e', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'E1.31', 'UHD', 'UHD', NULL, NULL, true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_plans (id, tenant_id, name, code, type, description, frequency, is_active, customer_id, site_id) VALUES ('8e3c38ce-ab77-4046-8dad-5ae63c30865d', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'E1.24', 'XFMRDRY', 'HV/LV Cast Resin Transformer (AN/AF)', NULL, NULL, true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_plans (id, tenant_id, name, code, type, description, frequency, is_active, customer_id, site_id) VALUES ('b75e4d74-9f49-45a1-a84f-5fafcdf6da00', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'E1.24.1', 'XFMROIL', 'HV/LV Liquid Filled Transformers', NULL, NULL, true, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_plans (id, tenant_id, name, code, type, description, frequency, is_active, customer_id, site_id) VALUES ('528570ab-4313-4308-8148-a8e923f95eb9', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'E1.X1', NULL, NULL, NULL, NULL, false, NULL, NULL) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.job_plans (id, tenant_id, name, code, type, description, frequency, is_active, customer_id, site_id) VALUES ('e4b730d8-c926-4efd-89b5-9083a42e2c84', 'ccca00fc-cbc8-442e-9489-0f1f216ddca8', 'E1.X2', NULL, NULL, NULL, NULL, false, NULL, NULL) ON CONFLICT (id) DO NOTHING;
"""

ALIAS_SQL = """\

-- ── 1 importer alias ────────────────────────────────────────────
INSERT INTO public.job_plan_aliases (id, tenant_id, source_system, external_code, job_plan_id) VALUES ('a3fe2507-a469-4e72-9ae8-8413df0eb660','ccca00fc-cbc8-442e-9489-0f1f216ddca8','delta','MVSWBD','ccb508a6-5848-4457-8bc7-5952bb7d5d99') ON CONFLICT (id) DO NOTHING;
"""

FOOTER = """\

COMMIT;
"""


def extract_items_blob(path: Path) -> str:
    raw = path.read_text(encoding="utf-8")
    outer = json.loads(raw)
    result_text = outer["result"]
    m = re.search(r"<untrusted-data-[^>]+>\s*(\[.*\])\s*</untrusted-data-[^>]+>", result_text, re.S)
    if not m:
        raise SystemExit("Could not find data array in items dump")
    rows = json.loads(m.group(1))
    if len(rows) != 1 or "sql_blob" not in rows[0]:
        raise SystemExit(f"Unexpected dump shape: keys={[r.keys() for r in rows]!r}")
    return rows[0]["sql_blob"]


def main() -> int:
    if ITEMS_DUMP is None or not ITEMS_DUMP.exists():
        print("Usage: build-equinix-seed.py <path-to-items-dump.txt>", file=sys.stderr)
        return 1
    items_sql = extract_items_blob(ITEMS_DUMP)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", encoding="utf-8", newline="\n") as f:
        f.write(HEADER)
        f.write(PLANS_SQL)
        f.write("\n-- ── 649 job plan items ─────────────────────────────────────────\n")
        f.write(items_sql)
        f.write("\n")
        f.write(ALIAS_SQL)
        f.write(FOOTER)
    print(f"Wrote {OUT}")
    print(f"Items SQL length: {len(items_sql):,} chars")
    return 0


if __name__ == "__main__":
    sys.exit(main())
