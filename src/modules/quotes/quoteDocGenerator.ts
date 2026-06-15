// ---------------------------------------------------------------------------
// Quote document generators — Word (.docx) and Excel (.xlsx)
// ---------------------------------------------------------------------------
// Word: fetches /templates/sks-quote-template.docx, injects quote data into
//       Word SDT content controls + title text box, rebuilds line items table.
// Excel: fetches /templates/sks-job-creation-template.xlsx, fills specific
//        cells in the Job Creation and Budget sheets, downloads the result.
// ---------------------------------------------------------------------------

import JSZip from "jszip";

// ---------------------------------------------------------------------------
// Shared types (subset of QuoteDetail used here)
// ---------------------------------------------------------------------------

export interface DocLineItem {
  line_number: number;
  description: string;
  quantity_thousandths: number;
  unit: string | null;
  unit_rate_cents: number;
  line_total_cents: number;
  category: string | null;
}

export interface QuoteDocData {
  quote_number: string;
  project_name: string | null;
  customer_name: string | null;
  estimator_name: string | null;
  scope_of_works: string | null;
  clarifications: string | null;
  subtotal_cents: number;
  gst_cents: number;
  total_cents: number;
  attn_name: string | null;
  attn_first_name: string | null;
  attn_phone: string | null;
  address: string | null;
  po_number: string | null;
  workbench_job_no: string | null;
  line_items: DocLineItem[];
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function escXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function fmtMoney(cents: number): string {
  return (
    "$" +
    (cents / 100).toLocaleString("en-AU", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function fmtQty(thousandths: number): string {
  const n = thousandths / 1000;
  return n % 1 === 0 ? String(n) : n.toFixed(3).replace(/\.?0+$/, "");
}

function formatDocDate(d: Date): string {
  return d.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Number-to-words (Australian English)
// ---------------------------------------------------------------------------

function numToWords(n: number): string {
  if (n === 0) return "zero";
  const ones = [
    "", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
    "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
    "seventeen", "eighteen", "nineteen",
  ];
  const tens = [
    "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
  ];

  function hundreds(x: number): string {
    let r = "";
    if (x >= 100) { r += ones[Math.floor(x / 100)] + " hundred "; x %= 100; }
    if (x >= 20) {
      r += tens[Math.floor(x / 10)];
      if (x % 10) r += "-" + ones[x % 10];
      r += " ";
    } else if (x > 0) r += ones[x] + " ";
    return r.trim();
  }

  let result = "";
  if (n >= 1_000_000) { result += hundreds(Math.floor(n / 1_000_000)) + " million "; n %= 1_000_000; }
  if (n >= 1_000) { result += hundreds(Math.floor(n / 1_000)) + " thousand "; n %= 1_000; }
  if (n > 0) result += hundreds(n);
  return result.trim();
}

function amountToWords(cents: number): string {
  const dollars = Math.floor(cents / 100);
  const c = cents % 100;
  let r = numToWords(dollars) + (dollars === 1 ? " dollar" : " dollars");
  if (c > 0) r += " and " + numToWords(c) + (c === 1 ? " cent" : " cents");
  r += " exactly";
  return r.charAt(0).toUpperCase() + r.slice(1);
}

// ---------------------------------------------------------------------------
// Word SDT replacement
// Finds <w:sdtContent> following the given tag value and replaces its body.
// ---------------------------------------------------------------------------

function replaceSdt(xml: string, tagVal: string, innerXml: string): string {
  const tagSearch = `w:val="${tagVal}"`;
  const pos = xml.indexOf(tagSearch);
  if (pos === -1) return xml;

  const contentTag = "<w:sdtContent>";
  const contentClose = "</w:sdtContent>";
  const cs = xml.indexOf(contentTag, pos);
  const ce = xml.indexOf(contentClose, cs);
  if (cs === -1 || ce === -1) return xml;

  return xml.substring(0, cs) + contentTag + innerXml + contentClose + xml.substring(ce + contentClose.length);
}

function simpleRun(text: string, rPr = ""): string {
  return `<w:r>${rPr}<w:t xml:space="preserve">${escXml(text)}</w:t></w:r>`;
}

function multilineRun(text: string): string {
  const rPr = `<w:rPr><w:rFonts w:cstheme="minorHAnsi"/></w:rPr>`;
  return text
    .split("\n")
    .map((line, i, arr) => {
      const run = `<w:r>${rPr}<w:t xml:space="preserve">${escXml(line)}</w:t></w:r>`;
      return i < arr.length - 1 ? run + "<w:r><w:br/></w:r>" : run;
    })
    .join("");
}

// ---------------------------------------------------------------------------
// Title text box replacement
// The cover page has a floating text box with quoteNumber + project name.
// It appears twice in the XML (modern wsp + legacy VML fallback).
// We replace every <w:txbxContent> that contains the original SKS-16951.
// ---------------------------------------------------------------------------

function splitProjectLines(text: string, maxLen = 25): string[] {
  const upper = text.toUpperCase();
  const words = upper.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && cur.length + 1 + w.length > maxLen) { lines.push(cur); cur = w; }
    else cur = cur ? cur + " " + w : w;
  }
  if (cur) lines.push(cur);
  return lines;
}

function mkTitleTxbxContent(quoteNumber: string, projectName: string): string {
  const rPrXml =
    "<w:rPr><w:b/><w:color w:val=\"002060\"/><w:sz w:val=\"40\"/><w:szCs w:val=\"40\"/></w:rPr>";
  const pPrXml =
    "<w:pPr><w:spacing w:line=\"360\" w:lineRule=\"auto\"/><w:jc w:val=\"center\"/>" +
    "<w:rPr><w:b/><w:color w:val=\"002060\"/><w:sz w:val=\"40\"/><w:szCs w:val=\"40\"/></w:rPr></w:pPr>";

  const lines = splitProjectLines(projectName);
  let runs = `<w:r><w:rPr><w:b/><w:color w:val="002060"/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr><w:t xml:space="preserve">${escXml(quoteNumber)}</w:t></w:r>`;
  for (const line of lines) {
    runs += `<w:r><w:br/></w:r><w:r>${rPrXml}<w:t xml:space="preserve">${escXml(line)}</w:t></w:r>`;
  }
  runs += `<w:r>${rPrXml}<w:t/></w:r>`;

  return (
    `<w:txbxContent><w:p>${pPrXml}${runs}</w:p>` +
    `<w:p>${pPrXml}<w:r>${rPrXml}<w:t/></w:r></w:p></w:txbxContent>`
  );
}

function replaceTitleBox(xml: string, quoteNumber: string, projectName: string): string {
  const open = "<w:txbxContent>";
  const close = "</w:txbxContent>";
  const newContent = mkTitleTxbxContent(quoteNumber, projectName || "");
  let result = xml;
  let pos = 0;
  let replacedCount = 0;
  while (replacedCount < 2) {
    const s = result.indexOf(open, pos);
    if (s === -1) break;
    const e = result.indexOf(close, s);
    if (e === -1) break;
    const block = result.substring(s, e + close.length);
    // Only replace if this textbox references the template quote number
    if (block.includes(">SKS-16951<") || block.includes("SKS-16951")) {
      result = result.substring(0, s) + newContent + result.substring(e + close.length);
      pos = s + newContent.length;
      replacedCount++;
    } else {
      pos = e + close.length;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Line items table XML builders
// ---------------------------------------------------------------------------

const CAT_DOC_LABELS: Record<string, string> = {
  labour: "LABOUR",
  material: "MATERIALS",
  subcontractor: "SUBCONTRACTORS",
  one_off: "ONE-OFF",
  "": "OTHER",
};
const CAT_ORDER = ["labour", "material", "subcontractor", "one_off", ""];

function mkCell(w: number, text: string, opts: { bold?: boolean; right?: boolean; fill?: string; white?: boolean } = {}): string {
  const shd = opts.fill
    ? `<w:shd w:val="clear" w:color="auto" w:fill="${opts.fill}"/>`
    : "";
  const jc = opts.right ? `<w:jc w:val="right"/>` : "";
  const b = opts.bold ? "<w:b/>" : "";
  const color = opts.white ? `<w:color w:val="FFFFFF"/>` : "";
  return (
    `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${shd}` +
    `<w:tcMar><w:top w:w="60" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/>` +
    `<w:left w:w="115" w:type="dxa"/><w:right w:w="115" w:type="dxa"/></w:tcMar></w:tcPr>` +
    `<w:p><w:pPr><w:spacing w:before="40" w:after="40"/>${jc}</w:pPr>` +
    `<w:r><w:rPr>${b}${color}<w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>` +
    `<w:t xml:space="preserve">${escXml(text)}</w:t></w:r></w:p></w:tc>`
  );
}

function mkEmptyCell(w: number, fill?: string): string {
  const shd = fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : "";
  return (
    `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${shd}` +
    `<w:tcMar><w:top w:w="60" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/>` +
    `<w:left w:w="115" w:type="dxa"/><w:right w:w="115" w:type="dxa"/></w:tcMar></w:tcPr>` +
    `<w:p><w:pPr><w:spacing w:before="40" w:after="40"/></w:pPr>` +
    `<w:r><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr><w:t xml:space="preserve"/></w:r></w:p></w:tc>`
  );
}

function mkCatHeaderRow(label: string): string {
  return (
    `<w:tr><w:trPr><w:cantSplit/></w:trPr>` +
    mkCell(4400, label, { bold: true, fill: "F2F2F2" }) +
    mkEmptyCell(850, "F2F2F2") +
    mkEmptyCell(700, "F2F2F2") +
    mkEmptyCell(1250, "F2F2F2") +
    mkEmptyCell(1826, "F2F2F2") +
    `</w:tr>`
  );
}

function mkLineItemRow(desc: string, qtyS: string, unit: string, sellPrice: string, total: string): string {
  return (
    `<w:tr><w:trPr><w:cantSplit/></w:trPr>` +
    mkCell(4400, desc) +
    mkCell(850, qtyS) +
    mkCell(700, unit) +
    mkCell(1250, sellPrice, { right: true }) +
    mkCell(1826, total, { right: true }) +
    `</w:tr>`
  );
}

function mkCatSubtotalRow(label: string, amount: string): string {
  return (
    `<w:tr><w:trPr><w:cantSplit/></w:trPr>` +
    mkCell(4400, label, { bold: true }) +
    mkEmptyCell(850) +
    mkEmptyCell(700) +
    mkEmptyCell(1250) +
    mkCell(1826, amount, { bold: true, right: true }) +
    `</w:tr>`
  );
}

function mkSpanCell(text: string, fill?: string, bold = false, white = false): string {
  const shd = fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : "";
  const b = bold ? "<w:b/>" : "";
  const color = white ? `<w:color w:val="FFFFFF"/>` : "";
  return (
    `<w:tc><w:tcPr><w:tcW w:w="7200" w:type="dxa"/><w:gridSpan w:val="4"/>${shd}` +
    `<w:tcMar><w:top w:w="60" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/>` +
    `<w:left w:w="115" w:type="dxa"/><w:right w:w="115" w:type="dxa"/></w:tcMar></w:tcPr>` +
    `<w:p><w:pPr><w:spacing w:before="40" w:after="40"/><w:jc w:val="right"/></w:pPr>` +
    `<w:r><w:rPr>${b}${color}<w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>` +
    `<w:t xml:space="preserve">${escXml(text)}</w:t></w:r></w:p></w:tc>`
  );
}

function mkAmountCell(amount: string, fill?: string, bold = false, white = false): string {
  const shd = fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : "";
  const b = bold ? "<w:b/>" : "";
  const color = white ? `<w:color w:val="FFFFFF"/>` : "";
  return (
    `<w:tc><w:tcPr><w:tcW w:w="1826" w:type="dxa"/>${shd}` +
    `<w:tcMar><w:top w:w="60" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/>` +
    `<w:left w:w="115" w:type="dxa"/><w:right w:w="115" w:type="dxa"/></w:tcMar></w:tcPr>` +
    `<w:p><w:pPr><w:spacing w:before="40" w:after="40"/><w:jc w:val="right"/></w:pPr>` +
    `<w:r><w:rPr>${b}${color}<w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>` +
    `<w:t xml:space="preserve">${escXml(amount)}</w:t></w:r></w:p></w:tc>`
  );
}

function buildTableRows(items: DocLineItem[], subtotal: number, gst: number, total: number): string {
  const grouped = new Map<string, DocLineItem[]>();
  for (const item of items) {
    const cat = item.category?.toLowerCase() ?? "";
    (grouped.get(cat) ?? (grouped.set(cat, []), grouped.get(cat)!)).push(item);
  }

  const categoriesPresent = CAT_ORDER.filter((c) => (grouped.get(c)?.length ?? 0) > 0);
  const multiCat = categoriesPresent.length > 1;

  let rows = "";
  for (const cat of CAT_ORDER) {
    const catItems = grouped.get(cat);
    if (!catItems?.length) continue;

    if (multiCat) rows += mkCatHeaderRow(CAT_DOC_LABELS[cat] ?? "OTHER");

    for (const li of catItems) {
      rows += mkLineItemRow(
        li.description,
        fmtQty(li.quantity_thousandths),
        li.unit ?? "",
        fmtMoney(li.unit_rate_cents),
        fmtMoney(li.line_total_cents),
      );
    }

    if (multiCat) {
      const catTotal = catItems.reduce((s, i) => s + i.line_total_cents, 0);
      const label = (CAT_DOC_LABELS[cat] ?? "Other") + " Subtotal";
      const displayLabel = label.charAt(0).toUpperCase() + label.slice(1).toLowerCase().replace("subtotal", "Subtotal");
      rows += mkCatSubtotalRow(displayLabel, fmtMoney(catTotal));
    }
  }

  // Totals
  rows +=
    `<w:tr><w:trPr><w:cantSplit/></w:trPr>${mkSpanCell("Subtotal (ex GST)", "F2F2F2", true)}${mkAmountCell(fmtMoney(subtotal), "F2F2F2", true)}</w:tr>` +
    `<w:tr><w:trPr><w:cantSplit/></w:trPr>${mkSpanCell("GST (10%)")}${mkAmountCell(fmtMoney(gst))}</w:tr>` +
    `<w:tr><w:trPr><w:cantSplit/></w:trPr>${mkSpanCell("TOTAL (inc GST)", "002060", true, true)}${mkAmountCell(fmtMoney(total), "002060", true, true)}</w:tr>`;

  return rows;
}

function buildSummaryTableRows(items: DocLineItem[], subtotal: number, gst: number, total: number): string {
  const grouped = new Map<string, DocLineItem[]>();
  for (const item of items) {
    const cat = item.category?.toLowerCase() ?? "";
    (grouped.get(cat) ?? (grouped.set(cat, []), grouped.get(cat)!)).push(item);
  }

  let rows = "";
  for (const cat of CAT_ORDER) {
    const catItems = grouped.get(cat);
    if (!catItems?.length) continue;
    const catLabel = CAT_DOC_LABELS[cat] ?? "OTHER";
    const catTotal = catItems.reduce((s, li) => s + li.line_total_cents, 0);
    rows += mkLineItemRow(catLabel, "", "", "", fmtMoney(catTotal));
  }

  rows +=
    `<w:tr><w:trPr><w:cantSplit/></w:trPr>${mkSpanCell("Subtotal (ex GST)", "F2F2F2", true)}${mkAmountCell(fmtMoney(subtotal), "F2F2F2", true)}</w:tr>` +
    `<w:tr><w:trPr><w:cantSplit/></w:trPr>${mkSpanCell("GST (10%)")}${mkAmountCell(fmtMoney(gst))}</w:tr>` +
    `<w:tr><w:trPr><w:cantSplit/></w:trPr>${mkSpanCell("TOTAL (inc GST)", "002060", true, true)}${mkAmountCell(fmtMoney(total), "002060", true, true)}</w:tr>`;

  return rows;
}

function buildLumpSumTableRows(subtotal: number, gst: number, total: number): string {
  return (
    mkLineItemRow("Labour, materials, and associated works", "1", "Lump sum", "", fmtMoney(subtotal)) +
    `<w:tr><w:trPr><w:cantSplit/></w:trPr>${mkSpanCell("Subtotal (ex GST)", "F2F2F2", true)}${mkAmountCell(fmtMoney(subtotal), "F2F2F2", true)}</w:tr>` +
    `<w:tr><w:trPr><w:cantSplit/></w:trPr>${mkSpanCell("GST (10%)")}${mkAmountCell(fmtMoney(gst))}</w:tr>` +
    `<w:tr><w:trPr><w:cantSplit/></w:trPr>${mkSpanCell("TOTAL (inc GST)", "002060", true, true)}${mkAmountCell(fmtMoney(total), "002060", true, true)}</w:tr>`
  );
}

function replaceLineItemsTable(xml: string, items: DocLineItem[], subtotal: number, gst: number, total: number, mode: "detailed" | "summary" | "lump_sum" = "detailed"): string {
  // Find the line items table by its header content
  const marker = ">Description<";
  const markerPos = xml.indexOf(marker);
  if (markerPos === -1) return xml;

  const tblOpen = "<w:tbl>";
  const tblClose = "</w:tbl>";
  const tblStart = xml.lastIndexOf(tblOpen, markerPos);
  if (tblStart === -1) return xml;

  const tblEnd = xml.indexOf(tblClose, markerPos) + tblClose.length;
  const tableXml = xml.substring(tblStart, tblEnd);

  // Table properties (everything before first row)
  const firstRow = tableXml.indexOf("<w:tr>");
  const tblProps = tableXml.substring(0, firstRow);

  // Header row
  const headerEnd = tableXml.indexOf("</w:tr>", firstRow) + "</w:tr>".length;
  const headerRow = tableXml.substring(firstRow, headerEnd);

  // Build new body + totals
  const body = mode === "summary"
    ? buildSummaryTableRows(items, subtotal, gst, total)
    : mode === "lump_sum"
    ? buildLumpSumTableRows(subtotal, gst, total)
    : buildTableRows(items, subtotal, gst, total);

  return xml.substring(0, tblStart) + tblProps + headerRow + body + tblClose + xml.substring(tblEnd);
}

// ---------------------------------------------------------------------------
// Download helper
// ---------------------------------------------------------------------------

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ---------------------------------------------------------------------------
// generateQuoteDoc — Word download
// ---------------------------------------------------------------------------

export async function generateQuoteDoc(q: QuoteDocData, mode: "detailed" | "summary" | "lump_sum" = "detailed"): Promise<void> {
  const resp = await fetch("/templates/sks-quote-template.docx");
  if (!resp.ok) throw new Error("Could not load quote template");

  const zip = await JSZip.loadAsync(await resp.arrayBuffer());
  const docFile = zip.file("word/document.xml");
  if (!docFile) throw new Error("Template document.xml missing");

  let xml = await docFile.async("string");

  const today = new Date();
  const stdRpr = `<w:rPr><w:rFonts w:cstheme="minorHAnsi"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>`;
  const boldRpr = `<w:rPr><w:rFonts w:cstheme="minorHAnsi"/><w:b/><w:bCs/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>`;

  // 1. Replace SDT content controls
  xml = replaceSdt(xml, "QuoteDate", simpleRun(formatDocDate(today), stdRpr));
  xml = replaceSdt(xml, "QuoteNumber", simpleRun(q.quote_number, stdRpr));
  xml = replaceSdt(xml, "ContactName", simpleRun(q.attn_first_name ?? q.attn_name ?? "", stdRpr));
  xml = replaceSdt(xml, "ClientAddress", simpleRun(q.address ?? "", stdRpr));
  xml = replaceSdt(xml, "ClientEmail", simpleRun("", stdRpr));
  xml = replaceSdt(xml, "ProjectName", simpleRun(q.project_name ?? "", stdRpr));
  xml = replaceSdt(xml, "DearName", simpleRun(q.attn_name ?? "", stdRpr));
  xml = replaceSdt(xml, "ClientCompany", simpleRun(q.customer_name ?? "", stdRpr));
  xml = replaceSdt(xml, "RepName", simpleRun("Royce Milmlow", stdRpr));
  xml = replaceSdt(xml, "RepTitle", simpleRun("NSW Operations Manager", stdRpr));
  xml = replaceSdt(xml, "RepPhone", simpleRun("0432944014", stdRpr));
  xml = replaceSdt(xml, "RepEmail", simpleRun("royce.milmlow@sks.com.au", stdRpr));
  const scopeText = [
    q.scope_of_works ?? "",
    q.clarifications ? "Clarifications\n" + q.clarifications : "",
  ].filter(Boolean).join("\n\n");
  xml = replaceSdt(xml, "ScopeOfWorks", multilineRun(scopeText));
  xml = replaceSdt(xml, "TotalAmountWords", simpleRun(amountToWords(q.subtotal_cents), boldRpr));
  xml = replaceSdt(xml, "TotalAmount", simpleRun(fmtMoney(q.subtotal_cents) + " (excluding GST)", boldRpr));

  // 2. Replace cover-page title text box
  xml = replaceTitleBox(xml, q.quote_number, q.project_name ?? "");

  // 3. Rebuild line items table
  xml = replaceLineItemsTable(xml, q.line_items, q.subtotal_cents, q.gst_cents, q.total_cents, mode);

  // Write modified XML back
  zip.file("word/document.xml", xml);

  const blob = await zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  const filename = `SKS Quote - ${q.project_name || q.quote_number}.docx`;
  triggerDownload(blob, filename);
}

// ---------------------------------------------------------------------------
// generateJobExcel — Excel download (server-side)
// POSTs quote_id to /.netlify/functions/job-creation which uses exceljs to
// fill the template server-side (preserves formulas + dropdowns) and returns
// the binary xlsx. Budget uses COST (not sell) per user spec.
// ---------------------------------------------------------------------------

export async function generateJobExcel(quoteId: string): Promise<void> {
  const resp = await fetch("/.netlify/functions/job-creation", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quote_id: quoteId }),
  });
  if (!resp.ok) {
    let msg = `Server error ${resp.status}`;
    try { const j = await resp.json(); msg = (j as { error?: string }).error ?? msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  const blob = await resp.blob();
  const cd = resp.headers.get("Content-Disposition") ?? "";
  const match = cd.match(/filename="([^"]+)"/);
  const filename = match ? match[1] : `JobCreation-${quoteId}.xlsx`;
  triggerDownload(blob, filename);
}
