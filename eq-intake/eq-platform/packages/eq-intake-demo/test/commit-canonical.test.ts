/**
 * commit-canonical tests — uses a hand-built mock Supabase client +
 * a global fetch stub.
 *
 * Post-2026-05-24 cutover the helper no longer calls
 * supabase.rpc('eq_intake_commit_batch'). Instead it POSTs to
 * /.netlify/functions/intake-commit (the per-tenant orchestrator) and
 * reads fk_lookup from the response for cross-batch FK resolution.
 *
 * The Supabase client mock is now used only for the eq_intake_events
 * lifecycle (writes to shell_control on shared) and auth.getUser().
 *
 * Coverage:
 * - Happy path: customer commits, fetch called with correct body
 * - Empty bundle returns empty result, no fetch
 * - Auth error throws before any intake_event is created
 * - Commit failure (non-2xx, or {ok:false}) stops the bundle early
 * - FK resolution: customer fetch response's fk_lookup feeds contact rows
 */

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  commitBundleToCanonical,
  inferMapping,
  type SupabaseLikeClient,
} from "../src/canonical/commit-canonical.js";

// ---------------------------------------------------------------------------
// Mock Supabase client (eq_intake_events lifecycle + auth only)
// ---------------------------------------------------------------------------

interface MockState {
  insertedEvents: Array<Record<string, unknown>>;
  updatedEvents: Array<{ id: string; patch: Record<string, unknown> }>;
  authUser?: { id: string } | null;
}

function makeMockSupabase(state: MockState): SupabaseLikeClient {
  return {
    from: (table: string) => ({
      insert: async (row: unknown) => {
        if (table === "eq_intake_events") {
          state.insertedEvents.push(row as Record<string, unknown>);
        }
        return { data: null, error: null };
      },
      update: (patch: unknown) => ({
        eq: async (col: string, val: unknown) => {
          if (table === "eq_intake_events" && col === "intake_id") {
            state.updatedEvents.push({
              id: String(val),
              patch: patch as Record<string, unknown>,
            });
          }
          return { data: null, error: null };
        },
      }),
    }),
    auth: {
      getUser: async () =>
        state.authUser === null
          ? { data: { user: null }, error: { message: "no auth" } }
          : {
              data: { user: state.authUser ?? { id: "test-user-uuid" } },
              error: null,
            },
    },
  };
}

// ---------------------------------------------------------------------------
// Global fetch stub
// ---------------------------------------------------------------------------

interface FetchCall {
  url: string;
  body: {
    intake_id: string;
    table: string;
    rows: Array<Record<string, unknown>>;
    source_sig: string;
    schema_version: string;
    import_mode: string;
  };
}

interface FetchStubOptions {
  /** Return value per table. Default: ok with committed_count = rows.length. */
  responseFor?: (
    body: FetchCall["body"],
  ) => { status: number; body: unknown };
}

function installFetchStub(opts: FetchStubOptions = {}): { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const body = JSON.parse((init?.body as string) ?? "{}") as FetchCall["body"];
    calls.push({ url, body });

    const { status, body: respBody } = opts.responseFor
      ? opts.responseFor(body)
      : {
          status: 200,
          body: {
            ok: true,
            module: "core",
            committed_count: body.rows.length,
            committed_ids: body.rows.map((_, i) => `uuid-${body.table}-${i}`),
          },
        };

    return new Response(JSON.stringify(respBody), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  });
  // @ts-expect-error — overwriting global for the test
  globalThis.fetch = stub;
  return { calls };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const TENANT = "00000000-0000-4000-8000-000000000001";

const CUSTOMER_SHEET = {
  sheetName: "csv",
  headerRow: [
    "simPRO Customer ID",
    "Company Name",
    "First Name",
    "Last Name",
    "ABN",
    "Street Address",
    "Suburb",
    "State",
    "Postcode",
    "Email",
    "Primary Phone",
  ],
  rows: [
    {
      "simPRO Customer ID": "31",
      "Company Name": "Equinix (Australia) Enterprises Pty Ltd",
      "First Name": "",
      "Last Name": "",
      "ABN": "26 605 084 473",
      "Street Address": "Unit B, 639 Gardeners Road",
      "Suburb": "Mascot",
      "State": "NSW",
      "Postcode": "2020",
      "Email": "payable-au@ap.equinix.com",
      "Primary Phone": "0283372000",
    },
  ],
  meta: {
    encoding: "utf-8",
    delimiter: ",",
    totalRows: 1,
    emptyRowsSkipped: 0,
    malformedRows: 0,
    malformed: [],
    bomDetected: false,
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("inferMapping", () => {
  it("maps SimPRO Customer ID → external_id via x-eq-source-aliases", () => {
    const schema = {
      "x-eq-entity": "customer",
      properties: {
        external_id: {
          type: "string",
          "x-eq-source-aliases": ["simpro_customer_id", "customer_id"],
        },
        company_name: {
          type: "string",
          "x-eq-source-aliases": ["company_name", "company", "name"],
        },
        ignored_field: { type: "string" },
      },
    } as unknown as Parameters<typeof inferMapping>[1];

    const mapping = inferMapping(
      ["simPRO Customer ID", "Company Name", "Some Unmapped Column"],
      schema,
    );
    expect(mapping).toEqual({
      "simPRO Customer ID": "external_id",
      "Company Name": "company_name",
      "Some Unmapped Column": null,
    });
  });

  it("falls back to normalised field name when no alias matches", () => {
    const schema = {
      "x-eq-entity": "test",
      properties: {
        first_name: { type: "string" },
      },
    } as unknown as Parameters<typeof inferMapping>[1];
    const mapping = inferMapping(["First Name", "first_name"], schema);
    expect(mapping["First Name"]).toBe("first_name");
    expect(mapping["first_name"]).toBe("first_name");
  });
});

describe("commitBundleToCanonical — auth", () => {
  it("throws when no authenticated user", async () => {
    installFetchStub();
    const state: MockState = {
      insertedEvents: [],
      updatedEvents: [],
      authUser: null,
    };
    const supabase = makeMockSupabase(state);
    await expect(
      commitBundleToCanonical({
        supabase,
        bundle: { customer: CUSTOMER_SHEET as never },
        tenantId: TENANT,
      }),
    ).rejects.toThrow(/Cannot commit canonical without an authenticated user/);
    expect(state.insertedEvents).toHaveLength(0);
  });
});

describe("commitBundleToCanonical — empty bundle", () => {
  it("returns success with empty perEntity array; no fetch", async () => {
    const { calls } = installFetchStub();
    const state: MockState = { insertedEvents: [], updatedEvents: [] };
    const supabase = makeMockSupabase(state);
    const result = await commitBundleToCanonical({
      supabase,
      bundle: {},
      tenantId: TENANT,
    });
    expect(result.bundleSuccess).toBe(true);
    expect(result.perEntity).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe("commitBundleToCanonical — customer-only happy path", () => {
  it("creates intake event, POSTs /intake-commit, finalises event", async () => {
    const { calls } = installFetchStub();
    const state: MockState = { insertedEvents: [], updatedEvents: [] };
    const supabase = makeMockSupabase(state);
    const result = await commitBundleToCanonical({
      supabase,
      bundle: { customer: CUSTOMER_SHEET as never },
      tenantId: TENANT,
      sourceFilename: "customer_export.csv",
    });

    expect(result.bundleSuccess).toBe(true);
    expect(result.perEntity).toHaveLength(1);

    const ev = state.insertedEvents[0];
    expect(ev?.tenant_id).toBe(TENANT);
    expect(ev?.entity).toBe("customer");
    expect(ev?.source_filename).toBe("customer_export.csv");
    expect(ev?.status).toBe("committing");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("/.netlify/functions/intake-commit");
    expect(calls[0]?.body.table).toBe("customers");
    expect(calls[0]?.body.source_sig).toBe("customer_export.csv");
    expect(calls[0]?.body.import_mode).toBe("append");

    expect(state.updatedEvents).toHaveLength(1);
    expect(state.updatedEvents[0]?.patch.status).toBe("completed");
  });
});

describe("commitBundleToCanonical — commit failure stops bundle early", () => {
  it("does not commit later entities when an earlier POST fails", async () => {
    const { calls } = installFetchStub({
      responseFor: (body) => {
        if (body.table === "customers") {
          return { status: 500, body: { ok: false, error: "tenant_rpc_failed", detail: "tenant_id mismatch" } };
        }
        return {
          status: 200,
          body: { ok: true, module: "core", committed_count: 0, committed_ids: [] },
        };
      },
    });
    const state: MockState = { insertedEvents: [], updatedEvents: [] };
    const supabase = makeMockSupabase(state);

    const result = await commitBundleToCanonical({
      supabase,
      bundle: {
        customer: CUSTOMER_SHEET as never,
        site: CUSTOMER_SHEET as never,
        contact: CUSTOMER_SHEET as never,
      },
      tenantId: TENANT,
    });

    expect(result.bundleSuccess).toBe(false);
    expect(calls).toHaveLength(1);
    expect(result.perEntity).toHaveLength(1);
    expect(result.perEntity[0]?.fatalError).toContain("tenant_id mismatch");
    expect(state.updatedEvents[0]?.patch.status).toBe("failed");
  });
});

describe("commitBundleToCanonical — FK resolution from fk_lookup", () => {
  it("uses the customer fk_lookup from the orchestrator response to resolve contact.customer_id", async () => {
    const { calls } = installFetchStub({
      responseFor: (body) => {
        if (body.table === "customers") {
          return {
            status: 200,
            body: {
              ok: true,
              module: "core",
              committed_count: body.rows.length,
              committed_ids: ["11111111-2222-4333-8444-555566667777"],
              fk_lookup: { "31": "11111111-2222-4333-8444-555566667777" },
            },
          };
        }
        return {
          status: 200,
          body: {
            ok: true,
            module: "core",
            committed_count: body.rows.length,
            committed_ids: body.rows.map((_, i) => `uuid-${body.table}-${i}`),
          },
        };
      },
    });
    const state: MockState = { insertedEvents: [], updatedEvents: [] };
    const supabase = makeMockSupabase(state);

    const CONTACT_SHEET = {
      sheetName: "csv",
      headerRow: ["simPRO Contact ID", "simPRO Customer ID", "First Name", "Last Name", "Email"],
      rows: [
        {
          "simPRO Contact ID": "100",
          "simPRO Customer ID": "31",
          "First Name": "Ben",
          "Last Name": "Dunn",
          "Email": "bdunn@ap.equinix.com",
        },
      ],
      meta: {
        encoding: "utf-8",
        delimiter: ",",
        totalRows: 1,
        emptyRowsSkipped: 0,
        malformedRows: 0,
        malformed: [],
        bomDetected: false,
      },
    };

    const result = await commitBundleToCanonical({
      supabase,
      bundle: {
        customer: CUSTOMER_SHEET as never,
        contact: CONTACT_SHEET as never,
      },
      tenantId: TENANT,
    });

    expect(result.bundleSuccess).toBe(true);
    expect(calls).toHaveLength(2);

    const contactCall = calls[1];
    expect(contactCall?.body.table).toBe("contacts");
    const resolved = contactCall?.body.rows.find(
      (r) => r.customer_id === "11111111-2222-4333-8444-555566667777",
    );
    expect(resolved).toBeDefined();
  });
});
