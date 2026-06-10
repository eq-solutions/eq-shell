/**
 * Placeholder for the Quotes module. Slots in @eq/quotes when it's built.
 * Until then, this surfaces what's coming + a link to the Intake CSV
 * output that EQ Quotes will eventually ingest.
 */

export function QuotesStub(): JSX.Element {
  return (
    <div className="eq-module-stub">
      <h2>EQ Quotes</h2>
      <p>
        Not yet built. When it lands, EQ Quotes will ingest the
        site-centric CSV that EQ Intake produces — pick a site, see its
        customer + primary contact, build a quote.
      </p>
      <p>
        For now, use <strong>Intake → SimPRO bundle → EQ Quotes</strong>{" "}
        template to generate the CSV manually.
      </p>
    </div>
  );
}
