// Overnight fuzz harness — angle 1, edge-case CSV inputs.
// Throwaway file. Deleted after results captured in OVERNIGHT-REVIEW.

import { parseCsv } from "./dist/index.js";

const cases = [
  // --- Encoding / BOMs ---
  { name: "UTF-8 BOM + valid",                  input: "﻿a,b\n1,2\n" },
  { name: "UTF-16 LE BOM (not stripped)",       input: "￾a,b\n1,2\n" },
  { name: "Empty file",                          input: "" },
  { name: "Only header (no data rows)",          input: "a,b,c\n" },
  { name: "Only blank lines",                    input: "\n\n\n" },
  { name: "Header with leading whitespace",      input: "  a,  b\n1,2\n" },
  { name: "Header with trailing whitespace",     input: "a  ,b  \n1,2\n" },
  { name: "Duplicate header columns",            input: "a,a,b\n1,2,3\n" },
  { name: "Header with empty column",            input: "a,,b\n1,2,3\n" },

  // --- Quoting / escaping ---
  { name: "Quoted field with comma",             input: 'a,b\n"hello, world",2\n' },
  { name: "Quoted field with newline",           input: 'a,b\n"line1\nline2",2\n' },
  { name: "Quoted field with embedded quote",    input: 'a,b\n"he said ""hi""",2\n' },
  { name: "Unquoted single quote in field",      input: "a,b\nO'Brien,2\n" },
  { name: "Mismatched quote (unclosed)",         input: 'a,b\n"unclosed,2\n' },
  { name: "Backslash escape (not RFC)",          input: 'a,b\n"back\\slash",2\n' },

  // --- Line endings ---
  { name: "CRLF line endings",                   input: "a,b\r\n1,2\r\n3,4\r\n" },
  { name: "Mixed CRLF and LF",                   input: "a,b\r\n1,2\n3,4\r\n" },
  { name: "Old-Mac CR only",                     input: "a,b\r1,2\r3,4\r" },
  { name: "Missing final newline",               input: "a,b\n1,2" },

  // --- Row shape ---
  { name: "Row with too few fields",             input: "a,b,c\n1,2\n3,4,5\n" },
  { name: "Row with too many fields",            input: "a,b\n1,2,3,4\n5,6\n" },
  { name: "Empty cells in middle",               input: "a,b,c\n1,,3\n,,3\n1,,\n" },
  { name: "All-whitespace row",                  input: "a,b\n   ,   \n1,2\n" },

  // --- Delimiters ---
  { name: "Tab-delimited",                       input: "a\tb\n1\t2\n" },
  { name: "Pipe-delimited",                      input: "a|b\n1|2\n" },
  { name: "Semicolon-delimited",                 input: "a;b\n1;2\n" },
  { name: "Comma in field, semicolon delim",     input: 'a;b\n"hello, world";2\n' },

  // --- Unicode ---
  { name: "Unicode in headers",                  input: "勤怠,氏名\n1,2\n" },
  { name: "Unicode in cells",                    input: "name\nKofi Asanté\n李雷\nSarah O'Brien\n" },
  { name: "Emoji",                               input: "a,b\n🔥,💯\n" },
  { name: "RTL Arabic",                          input: "a,b\nمرحبا,2\n" },
  { name: "Combining diacritics (NFD)",          input: "name\nKofi Á́sante\n" },

  // --- Numbers as strings (Excel quirks) ---
  { name: "Scientific notation",                 input: "a,b\n1.23E+10,2\n" },
  { name: "Leading zeros (preserve?)",           input: "code\n00123\n0456\n" },
  { name: "Negative + currency",                 input: "amount\n-$1,234.56\n($789)\n" },

  // --- Large / abusive ---
  { name: "Very long field (10KB)",              input: "a,b\n" + "x".repeat(10000) + ",2\n" },
  { name: "Many columns (200)",                  input: Array.from({length:200}, (_,i)=>`c${i}`).join(",") + "\n" + Array.from({length:200},(_,i)=>i).join(",") + "\n" },
  { name: "Many rows (5000)",                    input: "a,b\n" + Array.from({length:5000},(_,i)=>`${i},x`).join("\n") + "\n" },

  // --- Multi-customer SimPRO shape (today's bug class) ---
  { name: "Quoted comma-list ID",                input: 'site_id,customer_id\n188,"31, 32, 23"\n189,32\n' },
];

const findings = [];
let ran = 0, threw = 0;

for (const c of cases) {
  ran++;
  try {
    const result = await parseCsv(c.input);
    findings.push({
      name: c.name,
      ok: true,
      headerRow: result.headerRow,
      rowCount: result.rows.length,
      meta: result.meta,
      firstRow: result.rows[0] ?? null,
    });
  } catch (e) {
    threw++;
    findings.push({
      name: c.name,
      ok: false,
      error: String(e.message ?? e),
    });
  }
}

console.log(JSON.stringify({ ran, threw, findings }, null, 2));
