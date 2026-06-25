/**
 * calibration-cert skill — reconciliation core (pure, no AI / no DB).
 *
 * Feeds the 12 real records extracted from the Trescal S568457 bundle through
 * `reconcileCalibrationCerts` against a representative slice of the live
 * sks-canonical equipment register, and asserts the update / confirm / create
 * split + the per-cert match decisions. This is the TS twin of the dry-run
 * that produced "2 update · 1 confirm · 9 new".
 */
import { describe, it, expect } from "vitest";
import { reconcileCalibrationCerts } from "../../src/skills/calibration-cert/index.js";
import type {
  CalibrationCertRecord,
  CalCertSourceTag,
  CanonicalAssetRef,
} from "../../src/skills/calibration-cert/index.js";

type Rec = CalibrationCertRecord & { source: CalCertSourceTag };

function rec(p: Partial<CalibrationCertRecord> & { cert_number: string }): Rec {
  return {
    asset_number: null,
    serial_number: null,
    make: null,
    model: null,
    unit_under_test: null,
    cal_date: null,
    cal_due: null,
    test_result: null,
    ...p,
    source: { file_name: `${p.cert_number}.pdf`, extracted_via: "vision" },
  };
}

// 12 certs from the Trescal S568457 bundle (vision extraction).
const CERTS: Rec[] = [
  rec({ cert_number: "S568457-1FL", asset_number: "CXS027014", serial_number: "68470187MV", make: "Fluke", model: "323", unit_under_test: "Fluke 323 Clamp Meter", cal_date: "28-Apr-2026", cal_due: "28-Apr-2027", test_result: "PASS" }),
  rec({ cert_number: "S568457-2FL", asset_number: "CXS027015", serial_number: "67560487MV", make: "Fluke", model: "117", unit_under_test: "Fluke 117 Digital Multimeter", cal_date: "28-Apr-2026", cal_due: "28-Apr-2027", test_result: "PASS" }),
  rec({ cert_number: "S568457-3FL", asset_number: "CXS027016", serial_number: "CXS027016", make: "Fluke", model: "T5-600", unit_under_test: "Fluke T5-600 Tester", cal_date: "28-Apr-2026", cal_due: "28-Apr-2027", test_result: "PASS" }),
  rec({ cert_number: "S568457-4FL", asset_number: "CXS027017", serial_number: "59540194WS", make: "Fluke", model: "T6-1000", unit_under_test: "Fluke T6-1000 Tester", cal_date: "28-Apr-2026", cal_due: "28-Apr-2027", test_result: "PASS" }),
  rec({ cert_number: "S568457-5FL", asset_number: "CXS027018", serial_number: "48200389WS", make: "Fluke", model: "T6-1000", unit_under_test: "Fluke T6-1000 Tester", cal_date: "28-Apr-2026", cal_due: "28-Apr-2027", test_result: "PASS" }),
  rec({ cert_number: "S568457-6FL", asset_number: "CXS027019", serial_number: "1787759", make: "Kyoritsu", model: "KEW2300R", unit_under_test: "Kyoritsu KEW2300R Current Tester", cal_date: "30-Apr-2026", cal_due: "30-Apr-2027", test_result: "PASS" }),
  rec({ cert_number: "S568457-7", asset_number: "CXS024951", serial_number: "79107547117", make: "NORBAR", model: "60", unit_under_test: "TORQUE WRENCH", cal_date: "22-Apr-2026", cal_due: "22-Apr-2027", test_result: "PASS" }),
  rec({ cert_number: "S568457-8", asset_number: "CXS024952", serial_number: "UJ14010", make: "TOPTUL", model: "ANAM1205", unit_under_test: "TORQUE WRENCH", cal_date: "22-Apr-2026", cal_due: "22-Apr-2027", test_result: "PASS" }),
  rec({ cert_number: "S568457-9FL", asset_number: "S16226", serial_number: null, make: "Metrel", model: "MI3155", unit_under_test: "Metrel MI3155 Multifunction Tester", cal_date: "23-Apr-2026", cal_due: "23-Apr-2027", test_result: "PASS" }),
  rec({ cert_number: "S568457-10FL", asset_number: "CXS027022", serial_number: "C222743684", make: "UNIT-T", model: "UT595-AU", unit_under_test: "UNIT-T UT595-AU Installation Tester", cal_date: "11-May-2026", cal_due: "11-May-2027", test_result: "LIMITED CALIBRATION" }),
  rec({ cert_number: "S568457-11FL", asset_number: "CXS027023", serial_number: "102604032", make: "Megger", model: "MIT515-2", unit_under_test: "Megger MIT515-2 5kV Insulation Tester", cal_date: "01-May-2026", cal_due: "01-May-2027", test_result: "PASS" }),
  rec({ cert_number: "S568457-12FL", asset_number: "CXS027024", serial_number: "101197534", make: "Megger", model: "DLRO10HD", unit_under_test: "Megger DLRO10HD Low Resistance Meter", cal_date: "01-May-2026", cal_due: "01-May-2027", test_result: "PASS" }),
];

// Representative slice of the live register (the 3 match targets + decoys
// that must NOT match). asset_ids are the real sks-canonical rows.
const REGISTER: CanonicalAssetRef[] = [
  { asset_id: "a38bf2b4-525c-40fa-8bf3-74df0ff85304", name: "AEGIS Multifunction UT595-AU", serial_number: "222743684" },
  { asset_id: "a9cef3f7-e84e-49ed-8d57-7987314a6dca", name: "Megger low ohmeter", serial_number: "101197534" },
  { asset_id: "3434bc9b-d995-46d3-a090-e778c37fcfc3", name: "Metrel InstalTest XD MI 3155", serial_number: "20151466" },
  { asset_id: "39a5f91c-57d6-4ad3-96e6-035069ec0ed6", name: "Fluke T5-1000 with clamp", serial_number: "42180294WS" },
  { asset_id: "0fb82796-b0c1-48d5-a39d-659228da319b", name: "10kV Megger MIT1025", serial_number: "102558008" },
  { asset_id: "1a201acd-c03a-468a-b7a7-d7b1fc048ede", name: "Fluke 233", serial_number: "55760034" },
];

const rows = reconcileCalibrationCerts(CERTS, REGISTER);

function byCert(certNo: string) {
  const r = rows.find((x) => x.record.cert_number === certNo);
  if (!r) throw new Error(`no row for ${certNo}`);
  return r;
}

describe("calibration-cert — reconcile against the register", () => {
  it("emits exactly one row per cert (no silent drops)", () => {
    expect(rows).toHaveLength(12);
  });

  it("splits the batch 2 update / 1 confirm / 9 create", () => {
    const tally = { update: 0, confirm: 0, create: 0 };
    for (const r of rows) tally[r.match.action] += 1;
    expect(tally).toEqual({ update: 2, confirm: 1, create: 9 });
  });

  it("matches an exact serial → high-confidence update, with cert fields mapped", () => {
    const r = byCert("S568457-12FL");
    expect(r.match).toMatchObject({
      action: "update",
      basis: "serial_exact",
      confidence: "high",
      asset_id: "a9cef3f7-e84e-49ed-8d57-7987314a6dca",
    });
    expect(r.candidate.external_id).toBe("CXS027024"); // backfills the asset tag
    expect(r.candidate.last_service_date).toBe("2026-05-01");
    expect(r.candidate.next_service_due).toBe("2027-05-01");
  });

  it("matches across prefix drift (cert 'C222743684' vs register '222743684')", () => {
    const r = byCert("S568457-10FL");
    expect(r.match).toMatchObject({
      action: "update",
      basis: "serial_fuzzy",
      asset_id: "a38bf2b4-525c-40fa-8bf3-74df0ff85304",
    });
    // LIMITED CALIBRATION must be flagged, never treated as a clean pass.
    expect(r.candidate.cal_result).toBe("limited");
    expect(r.warnings.some((w) => w.code === "non_pass_result")).toBe(true);
  });

  it("falls back to make+model when the cert has no serial → confirm", () => {
    const r = byCert("S568457-9FL");
    expect(r.match).toMatchObject({
      action: "confirm",
      basis: "make_model",
      confidence: "medium",
      asset_id: "3434bc9b-d995-46d3-a090-e778c37fcfc3",
    });
  });

  it("drops a serial that echoes the asset tag and treats the cert as new", () => {
    const r = byCert("S568457-3FL");
    expect(r.candidate.serial_number).toBeNull();
    expect(r.warnings.some((w) => w.code === "serial_echoes_tag")).toBe(true);
    expect(r.match.action).toBe("create");
  });

  it("treats genuinely new instruments as create, not a forced match", () => {
    for (const certNo of ["S568457-1FL", "S568457-4FL", "S568457-11FL"]) {
      expect(byCert(certNo).match.action).toBe("create");
    }
  });

  it("with no register supplied, every cert is a create", () => {
    const blind = reconcileCalibrationCerts(CERTS, []);
    expect(blind.every((r) => r.match.action === "create")).toBe(true);
  });
});
