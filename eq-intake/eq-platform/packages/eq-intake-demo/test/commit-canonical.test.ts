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
 *
 * NOTE: All shell_control and app_data access goes through SECURITY DEFINER
 * RPCs (eq_create_intake_event, eq_finish_intake_event,
 * eq_read_customers_by_intake) because those schemas are not REST-exposed.
 * Tests verify the RPC call shapes rather than from() call shapes.
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
  rpcCalls: Array<{ name: string; params: unknown }>;
  /** Override responses for eq_intake_commit_batch calls keyed by p_table. */
  commitBatchResponse?: (params: { p_table: string }) => {
    data: unknown;
    error: { message: string } | null;
  };
  /** Customers to return from eq_read_customers_by_intake. */
  customerLookupRows?: Array<{ customer_id: string; external_id: string }>;
  authUser?: { id: string } | null;
}

function makeMockSupabase(state: MockState): SupabaseLikeClient {
  return {
    from: (_table: string) => ({
      // from() is no longer called for eq_intake_events or customers —
      // all event lifecycle and FK reads go through RPCs (migrations 016, 019).
      // Keep the shape so structural typing still compiles.
      insert: async () => ({ data: null, error: null }),
      update: () => ({
        eq: async () => ({ data: null, error: null }),
      }),
      select: (_cols: string) => ({
        eq: async () => ({ data: [], error: null }),
      }),
    }) as unknown as ReturnType<SupabaseLikeClient["from"]>,

    rpc: async (name: string, params: unknown) => {
      state.rpcCalls.push({ name, params });

      // Lifecycle RPCs — always succeed unless explicitly overridden.
      if (name === "eq_create_intake_event") return { data: null, error: null };
      if (name === "eq_finish_intake_event") return { data: null, error: null };
      if (name === "eq_read_customers_by_intake") {
        return { data: state.customerLookupRows ?? [], error: null };
      }

      // eq_intake_commit_batch — delegate to override or default success.
      if (state.commitBatchResponse) {
        return state.commitBatchResponse(params as { p_table: string });
      }
      const rows = (params as { p_rows?: unknown[] }).p_rows ?? [];
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
    expect(state.rpcCalls).toHaveLength(0);
  });
});

describe("commitBundleToCanonical — empty bundle", () => {
  it("returns success with empty perEntity array", async () => {
    const state: MockState = { rpcCalls: [] };
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
    const state: MockState = { rpcCalls: [] };
    const supabase = makeMockSupabase(state);
    const result = await commitBundleToCanonical({
      supabase,
      bundle: { customer: CUSTOMER_SHEET as never },
      tenantId: TENANT,
      sourceFilename: "customer_export.csv",
    });

    expect(result.bundleSuccess).toBe(true);
    expect(result.perEntity).toHaveLength(1);

    // Verify the intake event was created via RPC (not direct table insert).
    const createCall = state.rpcCalls.find((c) => c.name === "eq_create_intake_event");
    expect(createCall).toBeDefined();
    const createParams = createCall?.params as Record<string, unknown>;
    expect(createParams.p_tenant_id).toBe(TENANT);
    expect(createParams.p_entity).toBe("customer");
    expect(createParams.p_source_filename).toBe("customer_export.csv");
    expect(createParams.p_status).toBe("committing");

    // Verify commit batch was called.
    const commitCalls = state.rpcCalls.filter((c) => c.name === "eq_intake_commit_batch");
    expect(commitCalls).toHaveLength(1);
    expect((commitCalls[0]?.params as { p_table: string }).p_table).toBe("customers");

    // Verify the intake event was finalised via RPC (not direct table update).
    const finishCall = state.rpcCalls.find((c) => c.name === "eq_finish_intake_event");
    expect(finishCall).toBeDefined();
    expect((finishCall?.params as Record<string, unknown>).p_status).toBe("completed");
  });
});

describe("commitBundleToCanonical — RPC failure stops bundle early", () => {
  it("does not commit later entities when an earlier RPC fails", async () => {
    const state: MockState = {
      rpcCalls: [],
      commitBatchResponse: (p) => {
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
    // Only one commit_batch call — the failure short-circuited before site/contact.
    const commitCalls = state.rpcCalls.filter((c) => c.name === "eq_intake_commit_batch");
    expect(commitCalls).toHaveLength(1);
    expect(result.perEntity).toHaveLength(1);
    expect(result.perEntity[0]?.fatalError).toContain("tenant_id mismatch");

    // The intake event for the failed entity is closed as 'failed' via RPC.
    const finishCall = state.rpcCalls.find((c) => c.name === "eq_finish_intake_event");
    expect(finishCall).toBeDefined();
    expect((finishCall?.params as Record<string, unknown>).p_status).toBe("failed");
  });
});

describe("commitBundleToCanonical — FK resolution between customer and contact", () => {
  it("uses the customer external_id → customer_id map to resolve contact.customer_id", async () => {
    const state: MockState = {
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

    // Two commit_batch calls — one per entity.
    const commitCalls = state.rpcCalls.filter((c) => c.name === "eq_intake_commit_batch");
    expect(commitCalls).toHaveLength(2);

    // FK read-back was done via RPC, not from("customers").
    const fkReadCall = state.rpcCalls.find((c) => c.name === "eq_read_customers_by_intake");
    expect(fkReadCall).toBeDefined();

    // Contact RPC's p_rows should contain customer_id resolved via FK map.
    const contactCommit = commitCalls.find(
      (c) => (c.params as { p_table: string }).p_table === "contacts",
    );
    expect(contactCommit).toBeDefined();
    const contactRows = (contactCommit?.params as { p_rows: Array<Record<string, unknown>> }).p_rows;
    const resolved = contactRows.find((r) => r.customer_id === "11111111-2222-4333-8444-555566667777");
    expect(resolved).toBeDefined();
  });
});
