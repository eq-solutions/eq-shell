// Overnight fuzz harness — angle 1, edge-case coercer inputs.
// Throwaway file. Gitignored. Findings written to OVERNIGHT-REVIEW.

import {
  coerceDate,
  coerceBoolean,
  coercePhoneAU,
  coerceAuState,
  coerceNumber,
  coerceString,
} from "./dist/index.js";

const dateCases = [
  // Valid baselines
  { in: "2026-05-19",       expect: "ok" },
  { in: "19/05/2026",       expect: "ok-au" },
  { in: "05/19/2026",       expect: "ambiguous-or-us" },
  // Invalid / nonsense
  { in: "31/02/2026",       expect: "reject (Feb 31)" },
  { in: "2026-13-45",       expect: "reject (month 13, day 45)" },
  { in: "Feb 30 2026",      expect: "reject (Feb 30)" },
  { in: "2026-02-29",       expect: "reject (not a leap year)" },
  { in: "2024-02-29",       expect: "ok (leap year)" },
  { in: "0000-01-01",       expect: "edge — year 0" },
  { in: "9999-12-31",       expect: "ok — far future" },
  { in: "-2026-05-19",      expect: "edge — negative year" },
  // Excel serial numbers
  { in: 45000,              expect: "?? — does it accept Excel serial?" },
  { in: "45000",            expect: "?? — string Excel serial" },
  { in: "44927",            expect: "?? — that's 2023-01-01 in Excel" },
  // Empty / whitespace / null-like
  { in: "",                 expect: "reject — empty" },
  { in: "  ",               expect: "reject — whitespace" },
  { in: null,               expect: "reject — null" },
  { in: undefined,          expect: "reject — undefined" },
  { in: "null",             expect: "reject — literal 'null'" },
  { in: "N/A",              expect: "reject — N/A" },
  // Excel-mangled dates
  { in: "1-May-26",         expect: "?? — Excel default" },
  { in: "1/5/26",           expect: "?? — 2-digit year" },
  { in: "01/05/2026 12:34", expect: "?? — datetime in date field" },
  // Time zones (none expected in pure date)
  { in: "2026-05-19T00:00:00Z",       expect: "ok or reject" },
  { in: "2026-05-19T00:00:00+10:00",  expect: "ok or reject" },
  // String trickery
  { in: " 2026-05-19 ",     expect: "ok — should trim" },
  { in: "2026-05-19\n",     expect: "ok — should trim newline" },
  { in: "2026.05.19",       expect: "?? — dot separator" },
  { in: "20260519",         expect: "?? — compact" },
];

const booleanCases = [
  { in: "true",  expect: true },
  { in: "TRUE",  expect: true },
  { in: "True",  expect: true },
  { in: "yes",   expect: true },
  { in: "Y",     expect: true },
  { in: "1",     expect: true },
  { in: 1,       expect: true },
  { in: true,    expect: true },
  { in: "false", expect: false },
  { in: "no",    expect: false },
  { in: "N",     expect: false },
  { in: "0",     expect: false },
  { in: 0,       expect: false },
  { in: false,   expect: false },
  // Sneaky
  { in: "",            expect: "??" },
  { in: " ",           expect: "??" },
  { in: null,          expect: "??" },
  { in: undefined,     expect: "??" },
  { in: "maybe",       expect: "??" },
  { in: "yeah",        expect: "??" },
  { in: "off",         expect: "??" },
  { in: "on",          expect: "??" },
  { in: "tRUE",        expect: "?? — mixed case" },
  { in: "true ",       expect: "?? — trailing space" },
  { in: 2,             expect: "?? — non-binary number" },
  { in: -1,            expect: "?? — negative" },
  { in: "1.0",         expect: "?? — float string" },
  { in: "TRUE\n",      expect: "?? — trailing newline" },
];

const phoneCases = [
  { in: "+61412345678",  expect: "ok" },
  { in: "0412 345 678",  expect: "ok" },
  { in: "0412-345-678",  expect: "ok" },
  { in: "(02) 9876 5432",expect: "ok — landline" },
  { in: "02 9876 5432",  expect: "ok" },
  { in: "+61 2 9876 5432",expect: "ok" },
  { in: "0011 1 555 0123",expect: "?? — overseas via 0011" },
  { in: "+1 555 0123",   expect: "?? — US number" },
  { in: "1300 123 456",  expect: "?? — 1300" },
  { in: "13 12 23",      expect: "?? — short" },
  { in: "0412345",       expect: "reject — too short" },
  { in: "041234567890",  expect: "?? — too long" },
  { in: "abc",           expect: "reject" },
  { in: "",              expect: "reject" },
  { in: null,            expect: "reject" },
  { in: "0412.345.678",  expect: "?? — dot separator" },
  { in: "0412/345/678",  expect: "?? — slash separator" },
];

const stateCases = [
  { in: "NSW",                    expect: "ok" },
  { in: "nsw",                    expect: "ok — lowercase" },
  { in: "New South Wales",        expect: "ok" },
  { in: "new south wales",        expect: "ok" },
  { in: "NEW SOUTH WALES",        expect: "ok" },
  { in: "N.S.W.",                 expect: "?? — dotted" },
  { in: "VIC",                    expect: "ok" },
  { in: "Vic",                    expect: "ok" },
  { in: "Victoria",               expect: "ok" },
  { in: "QLD",                    expect: "ok" },
  { in: "Qld",                    expect: "ok" },
  { in: "Queensland",             expect: "ok" },
  { in: "SA",                     expect: "ok" },
  { in: "WA",                     expect: "ok" },
  { in: "TAS",                    expect: "ok" },
  { in: "ACT",                    expect: "ok" },
  { in: "NT",                     expect: "ok" },
  { in: "AUS",                    expect: "reject" },
  { in: "Australia",              expect: "reject" },
  { in: "California",             expect: "reject" },
  { in: "",                       expect: "reject" },
  { in: " NSW ",                  expect: "ok — trim" },
  { in: "NSW\n",                  expect: "ok — trim newline" },
  { in: "NSW, Australia",         expect: "?? — combined" },
];

const numberCases = [
  { in: "123",         expect: 123 },
  { in: "123.45",      expect: 123.45 },
  { in: "-789",        expect: -789 },
  { in: "1,234.56",    expect: "?? — thousands sep" },
  { in: "1 234.56",    expect: "?? — space thousands (EU)" },
  { in: "1.234,56",    expect: "?? — EU decimal" },
  { in: "$1,234.56",   expect: "?? — currency prefix" },
  { in: "1234.56 AUD", expect: "?? — currency suffix" },
  { in: "(789)",       expect: "?? — accounting negative" },
  { in: "1.23e10",     expect: "?? — scientific" },
  { in: "1.23E+10",    expect: "?? — scientific +" },
  { in: "0x1F",        expect: "?? — hex" },
  { in: "Infinity",    expect: "?? — Infinity literal" },
  { in: "NaN",         expect: "?? — NaN literal" },
  { in: "",            expect: "reject" },
  { in: null,          expect: "reject" },
  { in: "abc",         expect: "reject" },
];

async function run(label, cases, fn) {
  console.log(`\n=== ${label} ===`);
  for (const c of cases) {
    try {
      const result = fn(c.in);
      console.log(`  ${JSON.stringify(c.in)} -> ${JSON.stringify(result)} (expected: ${c.expect})`);
    } catch (e) {
      console.log(`  ${JSON.stringify(c.in)} -> THREW ${e.message ?? e} (expected: ${c.expect})`);
    }
  }
}

await run("coerceDate",     dateCases,    (v) => coerceDate(v));
await run("coerceBoolean",  booleanCases, (v) => coerceBoolean(v));
await run("coercePhoneAU",  phoneCases,   (v) => coercePhoneAU(v));
await run("coerceAuState",  stateCases,   (v) => coerceAuState(v));
await run("coerceNumber",   numberCases,  (v) => coerceNumber(v));
