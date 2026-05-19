/**
 * commit-canonical tests — uses a hand-built mock Supabase client.
 *
 * We don't pull in @supabase/supabase-js — the helper is structurally typed
 * via SupabaseLikeClient, so the mocks just need shape compatibility.
 *
 * Coverage:
 * - Happy path: customer + site + contact all commit, FK resolution works
 * - Empty bundle (no entities provided) returns empty result
 * - Customer-only commit (no FK resolution path)
 * - RPC error stops the bundle before FK-dependent entities
 * - Auth error throws before any intake_event is created
 * - inferMapping resolves SimPRO headers via x-eq-source-aliases
 */

import { describe, it, expect, vi } from "vitest";
import {
  commitBundleToCanonical,
  inferMapping,
  type SupabaseLikeClient,
} from "../src/canonical/commit-canonical.js";

// ---------------------------------------------------------------------------
// Mock Supabase client
// ---------------------------------------------------------------------------

interface MockState {
  insertedEvents: Array<Record<string, unknown>>;
  updatedEvents: Array<{ id: string; patch: Record<string, unknown> }>;
  rpcCalls: Array<{ name: string; params: unknown }>;
  /** Override responses for specific RPC calls keyed by p_table. */
  rpcResponse?: (params: { p_table: string }) => {
    data: unknown;
    error: { message: string } | null;
  };
  /** Customers to return when buildCustomerIdMap queries by intake_id. */
  customerLookupRows?: Array<{ customer_id: string; external_id: string }>;
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
      // Used by buildCustomerIdMap — chained .select(...).eq(...)
      select: (_cols: string) => ({
        eq: async (_col: string, _val: unknown) => ({
          data: state.customerLookupRows ?? [],
          error: null,
        }),
      }),
    }) as unknown as ReturnType<SupabaseLikeClient["from"]>,
    rpc: async (name: string, params: unknown) => {
      state.rpcCalls.push({ name, params });
      if (state.rpcResponse) {
        return state.rpcResponse(params as { p_table: string });
      }
      // Default: pretend everything committed cleanly.
      const rows = (params as { p_rows: unknown[] }).p_rows ?? [];
      return {
        data: [{ committed_count: rows.length, committed_ids: rows.map((_, i) => `uuid-${i}`) }],
        error: null,
      };
    },
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

const TENANT = "00000000-0000-4000-8000-000000000001";

// Realistic SimPRO-shaped headers, matching x-eq-source-aliases on the
// canonical customer/site/contact schemas.
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
    // Pull the real customer schema via the same import path the helper uses
    // — async dynamic-import to avoid a hard import at the top of the file.
    return import("../src/canonical/commit-canonical.js").then(({ inferMapping }) => {
      // Use a tiny schema shape rather than the real one, so this test stays focused
      // on the alias-matching logic.
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
  });

  it("falls back to normalised field name when no alias matches", () => {
    const schema = {
      "x-eq-entity": "test",
      properties: {
        first_name: { type: "string" }, // no aliases declared
      },
    } as unknown as Parameters<typeof inferMapping>[1];
    const mapping = inferMapping(["First Name", "first_name"], schema);
    expect(mapping["First Name"]).toBe("first_name");
    expect(mapping["first_name"]).toBe("first_name");
  });
});

describe("commitBundleToCanonical — auth", () => {
  it("throws when no authenticated user", async () => {
    const state: MockState = {
      insertedEvents: [],
      updatedEvents: [],
      rpcCalls: [],
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
  it("returns success with empty perEntity array", async () => {
    const state: MockState = {
      insertedEvents: [],
      updatedEvents: [],
      rpcCalls: [],
    };
    const supabase = makeMockSupabase(state);
    const result = await commitBundleToCanonical({
      supabase,
      bundle: {},
      tenantId: TENANT,
    });
    expect(result.bundleSuccess).toBe(true);
    expect(result.perEntity).toEqual([]);
    expect(state.rpcCalls).toHaveLength(0);
  });
});

describe("commitBundleToCanonical — customer-only happy path", () => {
  it("creates intake event, calls RPC, finalises event", async () => {
    const state: MockState = {
      insertedEvents: [],
      updatedEvents: [],
      rpcCalls: [],
    };
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

    expect(state.rpcCalls).toHaveLength(1);
    expect(state.rpcCalls[0]?.name).toBe("eq_intake_commit_batch");
    expect((state.rpcCalls[0]?.params as { p_table: string }).p_table).toBe(
      "customers",
    );

    expect(state.updatedEvents).toHaveLength(1);
    expect(state.updatedEvents[0]?.patch.status).toBe("completed");
  });
});

describe("commitBundleToCanonical — RPC failure stops bundle early", () => {
  it("does not commit later entities when an earlier RPC fails", async () => {
    const state: MockState = {
      insertedEvents: [],
      updatedEvents: [],
      rpcCalls: [],
      rpcResponse: (p) => {
        if (p.p_table === "customers") {
          return { data: null, error: { message: "tenant_id mismatch" } };
        }
        return { data: [{ committed_count: 0, committed_ids: [] }], error: null };
      },
    };
    const supabase = makeMockSupabase(state);

    const result = await commitBundleToCanonical({
      supabase,
      bundle: {
        customer: CUSTOMER_SHEET as never,
        site: CUSTOMER_SHEET as never, // reused shape — just to prove site/contact get skipped
        contact: CUSTOMER_SHEET as never,
      },
      tenantId: TENANT,
    });

    expect(result.bundleSuccess).toBe(false);
    // Only the customer RPC was called — the failure short-circuited.
    expect(state.rpcCalls).toHaveLength(1);
    expect(result.perEntity).toHaveLength(1);
    expect(result.perEntity[0]?.fatalError).toContain("tenant_id mismatch");
    // The intake event for the failed entity is closed as 'failed'.
    expect(state.updatedEvents[0]?.patch.status).toBe("failed");
  });
});

describe("commitBundleToCanonical — FK resolution between customer and contact", () => {
  it("uses the customer external_id → customer_id map to resolve contact.customer_id", async () => {
    const state: MockState = {
      insertedEvents: [],
      updatedEvents: [],
      rpcCalls: [],
      customerLookupRows: [{ customer_id: "11111111-2222-4333-8444-555566667777", external_id: "31" }],
    };
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
    // Two RPC calls — one per entity.
    expect(state.rpcCalls).toHaveLength(2);

    // Contact RPC's p_rows should contain customer_id = "11111111-2222-4333-8444-555566667777" (resolved).
    const contactCall = state.rpcCalls[1];
    expect((contactCall?.params as { p_table: string }).p_table).toBe("contacts");
    const contactRows = (contactCall?.params as { p_rows: Array<Record<string, unknown>> })
      .p_rows;
    // At least one row should have the resolved customer_id.
    const resolved = contactRows.find((r) => r.customer_id === "11111111-2222-4333-8444-555566667777");
    expect(resolved).toBeDefined();
  });
});
