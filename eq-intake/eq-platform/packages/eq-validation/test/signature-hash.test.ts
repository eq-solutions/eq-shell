import { describe, it, expect } from "vitest";
import { computeSignatureHash } from "../src/signature-hash.js";

describe("computeSignatureHash", () => {
  it("returns a 64-character hex SHA-256", async () => {
    const hash = await computeSignatureHash({
      entity: "staff",
      columns: ["first_name", "last_name", "email"],
      sampleRows: [
        { first_name: "Alex", last_name: "Smith", email: "alex@example.com" },
      ],
    });
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is stable across whitespace + casing changes in column names", async () => {
    const a = await computeSignatureHash({
      entity: "staff",
      columns: ["first_name", "last_name", "email"],
      sampleRows: [{ first_name: "A", last_name: "B", email: "a@b.com" }],
    });
    const b = await computeSignatureHash({
      entity: "staff",
      columns: ["First Name", "  last_name  ", "EMAIL"],
      sampleRows: [{ "First Name": "A", "  last_name  ": "B", "EMAIL": "a@b.com" }],
    });
    expect(a).toBe(b);
  });

  it("is stable across column reordering", async () => {
    const a = await computeSignatureHash({
      entity: "staff",
      columns: ["first_name", "last_name", "email"],
      sampleRows: [{ first_name: "A", last_name: "B", email: "a@b.com" }],
    });
    const b = await computeSignatureHash({
      entity: "staff",
      columns: ["email", "first_name", "last_name"],
      sampleRows: [{ email: "a@b.com", first_name: "A", last_name: "B" }],
    });
    expect(a).toBe(b);
  });

  it("changes when a column is added or removed", async () => {
    const a = await computeSignatureHash({
      entity: "staff",
      columns: ["first_name", "last_name"],
      sampleRows: [{ first_name: "A", last_name: "B" }],
    });
    const b = await computeSignatureHash({
      entity: "staff",
      columns: ["first_name", "last_name", "email"],
      sampleRows: [{ first_name: "A", last_name: "B", email: "a@b.com" }],
    });
    expect(a).not.toBe(b);
  });

  it("changes when entity differs", async () => {
    const a = await computeSignatureHash({
      entity: "staff",
      columns: ["name"],
      sampleRows: [{ name: "Switchboard 3" }],
    });
    const b = await computeSignatureHash({
      entity: "asset",
      columns: ["name"],
      sampleRows: [{ name: "Switchboard 3" }],
    });
    expect(a).not.toBe(b);
  });
});
