/**
 * `maximo-pdf-wo` skill — end-to-end fixture tests.
 *
 * The fixture set in `eq-validation/test/fixtures/equinix-maximo-pdf-wo-2026-05-19/`
 * contains 4 real Equinix Maximo PDFs (3 scans + 1 clean print), 7 WOs total.
 *
 * IMPORTANT: every PDF in this fixture is CCITTFax-encoded — `unpdf` returns
 * zero extractable text for all of them. They all route through vision. The
 * skill's text path is wired up for the case where Maximo's PDF rendering
 * ships a born-digital print, but this fixture doesn't exercise it.
 *
 * To avoid burning live Anthropic API calls in unit tests, the mock AI
 * provider returns canned `work_orders[]` keyed by file name. The canned
 * payloads mirror the WO# / asset / dates table in the fixture README.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import type {
  AIProvider,
  ExtractInput,
  ExtractResult,
  MapResult,
} from "@eq/ai";
import { parseMaximoPdfWo } from "../../src/skills/maximo-pdf-wo/index.js";

// ----------------------------------------------------------------------------
// Fixture-loading + mock vision
// ----------------------------------------------------------------------------

const __dirname = (() => {
  try {
    return fileURLToPath(new URL(".", import.meta.url));
  } catch {
    return process.cwd();
  }
})();

const FIXTURE_DIR = resolve(
  __dirname,
  "../../../eq-validation/test/fixtures/equinix-maximo-pdf-wo-2026-05-19",
);

// Skip-if-missing: the fixture lives on a parallel in-flight branch. When
// CI runs from a clean checkout before that branch merges, skip cleanly
// rather than failing.
const HAS_FIXTURE =
  existsSync(FIXTURE_DIR) &&
  existsSync(resolve(FIXTURE_DIR, "CUFT Work Order.pdf"));

function fixtureFile(name: string): { bytes: Uint8Array; fileName: string } {
  const bytes = readFileSync(resolve(FIXTURE_DIR, name));
  return { bytes: new Uint8Array(bytes), fileName: name };
}

/**
 * Canned vision payloads matching the fixture README's WO table.
 * Each entry is keyed by the source PDF filename.
 *
 * Field shapes use the labels printed on the Maximo header (per
 * `MAXIMO_WO_EXTRACT_SCHEMA`); the skill's mapping layer transforms them.
 */
const CANNED_VISION: Record<string, unknown[]> = {
  "20260519090849405.pdf": [
    {
      wo_number: "4398474",
      site: "AU01-CA1",
      asset: "1070 — CA1-TS-AC-29-ATS",
      serial_number: "N/A",
      status: "WAPPROV",
      location: "CA1-GF-22 - CA1-GF-Node Room",
      work_type: "PM",
      priority: 3,
      job_plan: "ATS-3 - E1.8 ATS-Automatic Transfer Switches",
      crew_id: null,
      target_start: "20-May-2026",
      target_finish: "20-May-2026",
      actual_start: null,
      actual_finish: null,
      classification: "ATS-Auto Transfer Switch",
    },
    {
      wo_number: "4406648",
      site: "AU01-CA1",
      asset: "1135 — CA1-MECH-POP-A",
      serial_number: "N/A",
      status: "WAPPROV",
      location: "CA1-GF-23 - CA1-GF-POP A",
      work_type: "PM",
      priority: 3,
      job_plan: "ATS-3 - E1.8 ATS-Automatic Transfer Switches",
      crew_id: null,
      target_start: "20-May-2026",
      target_finish: "20-May-2026",
      actual_start: null,
      actual_finish: null,
      classification: "ATS-Auto Transfer Switch",
    },
  ],
  "20260519090925883.pdf": [
    {
      wo_number: "4406759",
      site: "AU01-CA1",
      asset: "1137 — CA1-MECH-POP-B",
      serial_number: "N/A",
      status: "WAPPROV",
      location: "CA1-GF-24 - CA1-GF-POP B",
      work_type: "PM",
      priority: 3,
      job_plan: "ATS-3 - E1.8 ATS-Automatic Transfer Switches",
      crew_id: null,
      target_start: "20-May-2026",
      target_finish: "20-May-2026",
      actual_start: null,
      actual_finish: null,
      classification: "ATS-Auto Transfer Switch",
    },
    {
      wo_number: "4408095",
      site: "AU01-CA1",
      asset: "1158 — CA1-SMDB-1-1A-GLP (ATS)",
      serial_number: "N/A",
      status: "WAPPROV",
      location: "CA1-L1-25 - CA1-L1-Switch Room",
      work_type: "PM",
      priority: 3,
      job_plan: "ATS-3 - E1.8 ATS-Automatic Transfer Switches",
      crew_id: null,
      target_start: "20-May-2026",
      target_finish: "20-May-2026",
      actual_start: null,
      actual_finish: null,
      classification: "ATS-Auto Transfer Switch",
    },
  ],
  "20260519091018936.pdf": [
    {
      wo_number: "4408213",
      site: "AU01-CA1",
      asset: "1159 — CA1-LVSB-1-1A-DHATS-1-1B (ATS)",
      serial_number: "N/A",
      status: "WAPPROV",
      location: "CA1-L1-26 - CA1-L1-MSB Room",
      work_type: "PM",
      priority: 3,
      job_plan: "ATS-3 - E1.8 ATS-Automatic Transfer Switches",
      crew_id: null,
      target_start: "20-May-2026",
      target_finish: "20-May-2026",
      actual_start: null,
      actual_finish: null,
      classification: "ATS-Auto Transfer Switch",
    },
    {
      wo_number: "4409209",
      site: "AU01-CA1",
      asset: "1170 — CA1-SMDB-1-2A-GLP (ATS)",
      serial_number: "N/A",
      status: "WAPPROV",
      location: "CA1-L1-27 - CA1-L1-Switch Room",
      work_type: "PM",
      priority: 3,
      job_plan: "ATS-3 - E1.8 ATS-Automatic Transfer Switches",
      crew_id: null,
      target_start: "20-May-2026",
      target_finish: "20-May-2026",
      actual_start: null,
      actual_finish: null,
      classification: "ATS-Auto Transfer Switch",
    },
  ],
  "CUFT Work Order.pdf": [
    {
      wo_number: "4501310",
      site: "AU01-CA1",
      asset: "CA1-PTP - CA1-Comprehensive Utility Failure Test (PTP)",
      serial_number: "N/A",
      status: "WAPPROV",
      location: "CA1-Site Wide",
      work_type: "PM",
      priority: 2,
      job_plan: "PTP-A - E1.33 PTP-Comprehensive Utility Failure Test",
      crew_id: null,
      target_start: "20-Jun-2026",
      target_finish: "20-Jun-2026",
      actual_start: null,
      actual_finish: null,
      classification: "BLDFAB-Building Fabric",
    },
  ],
};

function mockAi(): AIProvider {
  let lastFileName = "";
  return {
    async extract(input: ExtractInput): Promise<ExtractResult> {
      // Identify which fixture this is by matching the base64 prefix back to
      // file bytes. Simpler: every test that uses this mock sets fileName as
      // a documentTypeHint suffix, but `extract` doesn't take fileName. We
      // fall back to matching against the entire base64 we cached.
      const matched = matchFixtureByBase64(input.fileBase64);
      lastFileName = matched ?? lastFileName;
      const wos = matched ? CANNED_VISION[matched] ?? [] : [];
      return {
        extracted: { work_orders: wos },
        fieldConfidence: { work_orders: 0.95 },
        rawText: `MOCK VISION OUTPUT for ${matched ?? "<unknown>"}`,
        uncertainFields: [],
        illegibleRegions: [],
        warnings: [],
        metadata: {
          estimatedPages: 1,
          estimatedCaptureMethod: "scan",
          appearsSigned: false,
          appearsComplete: true,
        },
        metrics: {
          provider: "mock",
          model: "mock",
          tokensIn: 0,
          tokensOut: 0,
          latencyMs: 0,
          success: true,
          retried: false,
          startedAt: new Date().toISOString(),
        },
      };
    },
    async map(): Promise<MapResult> {
      throw new Error("not used by maximo-pdf-wo");
    },
  };
}

// Cache file → base64 once so the mock can match incoming requests back to
// a fixture name without the skill having to leak its filename through.
// Skipped if the fixture isn't present (see HAS_FIXTURE).
const BASE64_TO_NAME = new Map<string, string>();
if (HAS_FIXTURE) {
  for (const name of Object.keys(CANNED_VISION)) {
    const bytes = readFileSync(resolve(FIXTURE_DIR, name));
    BASE64_TO_NAME.set(Buffer.from(bytes).toString("base64"), name);
  }
}
function matchFixtureByBase64(b64: string): string | undefined {
  return BASE64_TO_NAME.get(b64);
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe.skipIf(!HAS_FIXTURE)("maximo-pdf-wo skill — full fixture set", () => {
  it("parses all 4 fixture PDFs into 2 maintenance_checks + 7 check_assets", async () => {
    const ai = mockAi();
    const result = await parseMaximoPdfWo({
      files: [
        fixtureFile("20260519090849405.pdf"),
        fixtureFile("20260519090925883.pdf"),
        fixtureFile("20260519091018936.pdf"),
        fixtureFile("CUFT Work Order.pdf"),
      ],
      ai,
    });

    expect(result.bundles).toHaveLength(2);

    const allAssets = result.bundles.flatMap((b) => b.check_assets);
    expect(allAssets).toHaveLength(7);

    // Every WO# from the README table is present, exactly once.
    const woNumbers = allAssets.map((a) => a.work_order_number).sort();
    expect(woNumbers).toEqual([
      "4398474",
      "4406648",
      "4406759",
      "4408095",
      "4408213",
      "4409209",
      "4501310",
    ]);

    // No hard warnings on a happy-path fixture.
    const hardWarnings = result.warnings.filter(
      (w) =>
        w.code !== "vision_low_confidence" && w.code !== "vision_unavailable",
    );
    expect(hardWarnings).toEqual([]);
  });

  it("groups the 6 ATS WOs into one bundle and the CUFT WO into its own", async () => {
    const result = await parseMaximoPdfWo({
      files: [
        fixtureFile("20260519090849405.pdf"),
        fixtureFile("20260519090925883.pdf"),
        fixtureFile("20260519091018936.pdf"),
        fixtureFile("CUFT Work Order.pdf"),
      ],
      ai: mockAi(),
    });

    const ats = result.bundles.find(
      (b) => b.maintenance_check.plan_code === "E1.8",
    );
    const cuft = result.bundles.find(
      (b) => b.maintenance_check.plan_code === "E1.33",
    );

    expect(ats).toBeDefined();
    expect(cuft).toBeDefined();

    expect(ats!.check_assets).toHaveLength(6);
    expect(cuft!.check_assets).toHaveLength(1);

    // ATS group fields
    expect(ats!.maintenance_check.site_code).toBe("CA1");
    expect(ats!.maintenance_check.site_code_raw).toBe("AU01-CA1");
    expect(ats!.maintenance_check.plan_code_raw).toBe("ATS-3");
    expect(ats!.maintenance_check.frequency).toBe("quarterly"); // suffix "3" → quarterly
    expect(ats!.maintenance_check.due_date).toBe("2026-05-20");
    expect(ats!.maintenance_check.start_date).toBe("2026-05-20");
    expect(ats!.maintenance_check.status).toBe("scheduled");
    // Multi-WO group → maximo_wo_number on the check is null (lives on each asset)
    expect(ats!.maintenance_check.maximo_wo_number).toBeNull();
    expect(ats!.group_key).toBe("CA1|E1.8|quarterly|2026-05-20");

    // CUFT group fields
    expect(cuft!.maintenance_check.site_code).toBe("CA1");
    expect(cuft!.maintenance_check.plan_code_raw).toBe("PTP-A");
    expect(cuft!.maintenance_check.frequency).toBe("annual"); // suffix "A" → annual
    expect(cuft!.maintenance_check.due_date).toBe("2026-06-20");
    // Singleton group → primary WO stamped on the check
    expect(cuft!.maintenance_check.maximo_wo_number).toBe("4501310");
    expect(cuft!.group_key).toBe("CA1|E1.33|annual|2026-06-20");
  });

  it("maps Maximo status / priority / work_type via enum aliases", async () => {
    const result = await parseMaximoPdfWo({
      files: [fixtureFile("CUFT Work Order.pdf")],
      ai: mockAi(),
    });

    const cuft = result.bundles[0]!;
    const asset = cuft.check_assets[0]!;

    expect(cuft.maintenance_check.status).toBe("scheduled"); // WAPPROV
    expect(asset.status).toBe("pending"); // mirrors check status at intake
    expect(asset.priority).toBe("high"); // priority 2
    expect(asset.work_type).toBe("PM");
    expect(asset.classification).toBe("BLDFAB-Building Fabric");
    expect(asset.target_start).toBe("2026-06-20");
    expect(asset.target_finish).toBe("2026-06-20");
    expect(asset.notes).toBe("Location: CA1-Site Wide");
  });

  it("splits asset cells: numeric-prefixed shape gives external_id, no-prefix shape does not", async () => {
    const result = await parseMaximoPdfWo({
      files: [
        fixtureFile("20260519090849405.pdf"),
        fixtureFile("CUFT Work Order.pdf"),
      ],
      ai: mockAi(),
    });

    const ats = result.bundles.find(
      (b) => b.maintenance_check.plan_code === "E1.8",
    )!;
    const cuft = result.bundles.find(
      (b) => b.maintenance_check.plan_code === "E1.33",
    )!;

    // Numeric-prefixed asset
    const ats4398474 = ats.check_assets.find(
      (a) => a.work_order_number === "4398474",
    )!;
    expect(ats4398474.asset_external_id).toBe("1070");
    expect(ats4398474.asset_name).toBe("CA1-TS-AC-29-ATS");

    // No-numeric-prefix asset (CUFT). Per the brief: "Match against
    // asset.external_id first (the numeric Maximo ID), fall back to fuzzy on
    // name." Since CA1-PTP is not numeric, it stays in the name and
    // external_id is null — the FK resolver downstream will fuzzy-match on
    // asset.name to find the CUFT asset.
    const cuftAsset = cuft.check_assets[0]!;
    expect(cuftAsset.asset_external_id).toBeNull();
    expect(cuftAsset.asset_name).toContain("CA1-PTP");
    expect(cuftAsset.asset_name).toContain("Comprehensive Utility Failure");
  });

  it("is idempotent: re-parsing the same fixtures yields identical bundles", async () => {
    const files = [
      fixtureFile("20260519090849405.pdf"),
      fixtureFile("20260519090925883.pdf"),
      fixtureFile("20260519091018936.pdf"),
      fixtureFile("CUFT Work Order.pdf"),
    ];
    const first = await parseMaximoPdfWo({ files, ai: mockAi() });
    const second = await parseMaximoPdfWo({ files, ai: mockAi() });

    expect(second.bundles).toEqual(first.bundles);
  });

  it("is iteration-order-independent: shuffling file order yields the same bundles", async () => {
    const inOrder = await parseMaximoPdfWo({
      files: [
        fixtureFile("20260519090849405.pdf"),
        fixtureFile("20260519090925883.pdf"),
        fixtureFile("20260519091018936.pdf"),
        fixtureFile("CUFT Work Order.pdf"),
      ],
      ai: mockAi(),
    });
    const shuffled = await parseMaximoPdfWo({
      files: [
        fixtureFile("CUFT Work Order.pdf"),
        fixtureFile("20260519091018936.pdf"),
        fixtureFile("20260519090849405.pdf"),
        fixtureFile("20260519090925883.pdf"),
      ],
      ai: mockAi(),
    });

    expect(shuffled.bundles).toEqual(inOrder.bundles);
  });

  it("records source provenance per bundle (extracted_via=vision for this fixture)", async () => {
    const result = await parseMaximoPdfWo({
      files: [fixtureFile("CUFT Work Order.pdf")],
      ai: mockAi(),
    });

    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({
      file_name: "CUFT Work Order.pdf",
      extracted_via: "vision",
      records_emitted: 1,
    });

    const cuft = result.bundles[0]!;
    expect(cuft.maintenance_check.source.file_name).toBe("CUFT Work Order.pdf");
    expect(cuft.maintenance_check.source.extracted_via).toBe("vision");
  });
});

describe.skipIf(!HAS_FIXTURE)("maximo-pdf-wo skill — warnings", () => {
  it("warns when no AI provider is supplied for a scanned PDF", async () => {
    const result = await parseMaximoPdfWo({
      files: [fixtureFile("CUFT Work Order.pdf")],
      // ai omitted on purpose
    });

    expect(result.bundles).toHaveLength(0);
    expect(result.warnings.some((w) => w.code === "vision_unavailable")).toBe(true);
  });
});
