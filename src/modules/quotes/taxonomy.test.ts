import { test } from "node:test";
import assert from "node:assert/strict";
import {
  QUOTE_STATUSES,
  STATUS_LABELS,
  ACTIVE_JOB_STATUSES,
  WON_EVER_STATUSES,
  CLOSED_LOST_STATUSES,
  OPEN_PIPELINE_STATUSES,
  QUOTE_CATEGORIES,
  CATEGORY_LABELS,
  FLASK_STATUS_TO_EQ,
  FLASK_CATEGORY_TO_EQ,
} from "./taxonomy";

// These lock the quote taxonomy "in writing" (accuracy risk #2 from the EQ Ops
// <-> Flask gap matrix). If a status/category is added or a group changes, a test
// here must change with it — that is the point.

const ALL = new Set<string>(QUOTE_STATUSES);

test("every status slug has a canonical label and vice versa", () => {
  for (const s of QUOTE_STATUSES) assert.ok(STATUS_LABELS[s], `missing label for ${s}`);
  for (const k of Object.keys(STATUS_LABELS)) assert.ok(ALL.has(k), `label for unknown status ${k}`);
});

test("status slugs are kebab-case and unique", () => {
  assert.equal(new Set(QUOTE_STATUSES).size, QUOTE_STATUSES.length);
  for (const s of QUOTE_STATUSES) assert.match(s, /^[a-z]+(-[a-z]+)*$/, `${s} is not kebab-case`);
});

test("every status group is a subset of QUOTE_STATUSES", () => {
  for (const grp of [ACTIVE_JOB_STATUSES, WON_EVER_STATUSES, CLOSED_LOST_STATUSES, OPEN_PIPELINE_STATUSES]) {
    for (const s of grp) assert.ok(ALL.has(s), `group has unknown status ${s}`);
  }
});

test("WON_EVER / CLOSED_LOST / OPEN_PIPELINE partition all statuses", () => {
  const union = new Set<string>([...WON_EVER_STATUSES, ...CLOSED_LOST_STATUSES, ...OPEN_PIPELINE_STATUSES]);
  assert.equal(union.size, QUOTE_STATUSES.length, "the three buckets must cover every status exactly once");
  for (const s of QUOTE_STATUSES) assert.ok(union.has(s), `${s} is in no bucket`);
  // pairwise disjoint
  const buckets = [WON_EVER_STATUSES, CLOSED_LOST_STATUSES, OPEN_PIPELINE_STATUSES];
  for (let i = 0; i < buckets.length; i++)
    for (let j = i + 1; j < buckets.length; j++)
      for (const s of buckets[i]) assert.ok(!buckets[j].has(s), `${s} is in two buckets`);
});

test("ACTIVE_JOB is a subset of WON_EVER and excludes the finished states", () => {
  for (const s of ACTIVE_JOB_STATUSES) assert.ok(WON_EVER_STATUSES.has(s));
  assert.ok(!ACTIVE_JOB_STATUSES.has("complete"));
  assert.ok(!ACTIVE_JOB_STATUSES.has("ready-to-invoice"));
  // the exact membership the pipeline win count depends on
  assert.deepEqual([...ACTIVE_JOB_STATUSES].sort(), [
    "active", "po-matched", "verbal-win", "won-awaiting-job-no", "won-job-created",
  ]);
});

test("category keys have labels and are unique", () => {
  assert.equal(new Set(QUOTE_CATEGORIES).size, QUOTE_CATEGORIES.length);
  for (const c of QUOTE_CATEGORIES) assert.ok(CATEGORY_LABELS[c], `missing label for category ${c}`);
});

test("Flask status map covers all 9 Flask statuses and lands on valid EQ slugs", () => {
  // app/quotes/status.py STATUSES (the Flask application-level source of truth)
  const flaskStatuses = [
    "Draft", "Submitted", "Client Reviewing", "Verbal Win",
    "Won-Awaiting Job No", "Won-Job Created", "Lost", "On Hold", "Withdrawn",
  ];
  for (const f of flaskStatuses) {
    const eq = FLASK_STATUS_TO_EQ[f];
    assert.ok(eq, `Flask status ${f} has no EQ mapping`);
    assert.ok(ALL.has(eq), `Flask status ${f} maps to unknown EQ slug ${eq}`);
  }
  // Withdrawn deliberately folds into cancelled (no EQ "withdrawn")
  assert.equal(FLASK_STATUS_TO_EQ["Withdrawn"], "cancelled");
});

test("Flask category map lands on valid EQ categories", () => {
  const cats = new Set<string>(QUOTE_CATEGORIES);
  for (const [flask, eq] of Object.entries(FLASK_CATEGORY_TO_EQ)) {
    assert.ok(cats.has(eq), `Flask category ${flask} maps to unknown EQ category ${eq}`);
  }
});
