// netlify/functions/canonical-outbox-quotes-scheduler.ts
//
// RETIRED — EQ Quotes (Flask app at quotes.eq.solutions) was retired 2026-06-25.
// Schedule removed so Netlify no longer fires this. File kept rather than deleted
// pending explicit sign-off.

export default async (): Promise<Response> =>
  new Response(JSON.stringify({ ok: true, status: 'retired' }), { status: 200 });
