import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compileRule } from "../src/cross-field-eval.js";

const __filename = fileURLToPath(import.meta.url);
const FIXTURES_DIR = join(dirname(__filename), "fixtures");

interface CrossFieldFixture {
  rules: string[];
  test_cases: Array<{
    rule_index: number;
    data: Record<string, unknown>;
    expected: boolean;
    note: string;
  }>;
}

describe("cross-field rule evaluator (fixture-driven)", async () => {
  const raw = await readFile(join(FIXTURES_DIR, "cross-field-test-cases.json"), "utf8");
  const fixture = JSON.parse(raw) as CrossFieldFixture;

  const compiled = fixture.rules.map((src) => ({
    src,
    fn: compileRule(src),
  }));

  for (const tc of fixture.test_cases) {
    const rule = compiled[tc.rule_index];
    if (!rule) throw new Error("fixture references missing rule_index " + tc.rule_index);
    const label = "rule[" + tc.rule_index + '] "' + rule.src + '" - ' + tc.note;

    it(label, () => {
      const result = rule.fn(tc.data);
      expect(result).toBe(tc.expected);
    });
  }
});

describe("cross-field rule compiler - security", () => {
  it("rejects raw JS-style function calls", () => {
    expect(() => compileRule("eval(\'1\')")).toThrow();
  });

  it("rejects assignment", () => {
    expect(() => compileRule("active = true")).toThrow();
  });

  it("compiles supported comparison + logical ops", () => {
    expect(() => compileRule("end_date == null OR end_date >= start_date")).not.toThrow();
    expect(() => compileRule("a > 1 AND b < 10")).not.toThrow();
    expect(() => compileRule("NOT active")).not.toThrow();
  });

  it("rejects rules that exceed the AST-depth limit", () => {
    // 7 ANDs => 8 nested binops => AST depth 9 (1 for outer AND + 8 inner)
    // Left-associative chaining grows AST depth linearly without growing
    // parser recursion, so this would have slipped past the old
    // MAX_DEPTH=32 recursion counter. The new AST-walk catches it.
    const tooDeep = "a == 1 AND b == 1 AND c == 1 AND d == 1 AND e == 1 AND f == 1 AND g == 1 AND h == 1";
    expect(() => compileRule(tooDeep)).toThrow(/too deep/i);

    // A 7-term chain (6 ANDs => AST depth 8) sits at the limit and must pass.
    const justUnder = "a == 1 AND b == 1 AND c == 1 AND d == 1 AND e == 1 AND f == 1 AND g == 1";
    expect(() => compileRule(justUnder)).not.toThrow();
  });
});
