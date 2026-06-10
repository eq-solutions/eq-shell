/**
 * EQ Solves Service
 * © 2026 EQ, a registered business name of CDC Solutions Pty Ltd
 * ACN 651 962 935 · ABN 40 651 962 935
 * Proprietary and confidential. All rights reserved.
 */
import Link from 'next/link'
import type { Metadata } from 'next'
import { EqFooter } from '@/components/ui/EqFooter'

export const metadata: Metadata = {
  title: 'Terms of Use — EQ Solves Service',
  description:
    'Terms of Use for EQ Solves Service, a proprietary product of CDC Solutions Pty Ltd trading as EQ.',
}

// Plain-English draft — review with Webb Financial / SaaS-literate lawyer before relying on
// in a commercial dispute. Sits at a public route (no auth required) so prospects and
// customers can read it before signing in. Linked from every footer.
export default function TermsPage() {
  return (
    <div className="min-h-screen flex flex-col bg-white">
      <header className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="max-w-3xl mx-auto">
          <Link href="/" className="text-sm font-bold text-eq-ink hover:text-eq-deep">
            EQ Solves Service
          </Link>
        </div>
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto px-6 py-10 text-[15px] leading-relaxed text-gray-700">
        <h1 className="text-3xl font-bold text-eq-ink">Terms of Use</h1>
        <p className="mt-2 text-sm text-gray-500">
          Last updated: 19 April 2026
        </p>

        <section className="mt-8 space-y-4">
          <h2 className="text-xl font-semibold text-eq-ink">1. Who we are</h2>
          <p>
            EQ Solves Service (&quot;the Service&quot;) is a software product
            of <strong>EQ</strong>, a registered business name of{' '}
            <strong>CDC Solutions Pty Ltd</strong> (ACN 651 962 935, ABN
            40 651 962 935), a company registered in Australia. In these
            Terms, &quot;EQ&quot;, &quot;we&quot;, &quot;us&quot; and
            &quot;our&quot; refer to CDC Solutions Pty Ltd trading as EQ.
          </p>
        </section>

        <section className="mt-8 space-y-4">
          <h2 className="text-xl font-semibold text-eq-ink">2. Licensed, not sold</h2>
          <p>
            The Service is licensed to you, not sold. By accessing or using
            the Service you agree to use it only as permitted by these Terms
            and by the written agreement between your organisation and EQ.
            No title, ownership, or intellectual-property rights in the
            Service transfer to you.
          </p>
        </section>

        <section className="mt-8 space-y-4">
          <h2 className="text-xl font-semibold text-eq-ink">3. Ownership of the Service</h2>
          <p>
            EQ owns all rights, title and interest in the Service — including
            the software, source code, database schema, user-interface
            designs, documentation, trade marks, branding and any
            improvements or derivative works. Our rights are protected by
            Australian and international copyright, trade-mark and trade-
            secret laws.
          </p>
          <p>
            The EQ mark (TM 2635095, registered in respect of property
            services) is a registered trade mark of CDC Solutions Pty Ltd.
            Additional registrations in software and SaaS classes are
            pending.
          </p>
        </section>

        <section className="mt-8 space-y-4">
          <h2 className="text-xl font-semibold text-eq-ink">4. Ownership of your data</h2>
          <p>
            You (or your organisation) retain ownership of the data you
            enter into the Service — your customer records, asset data,
            test results, photos, documents and reports. We process that
            data on your behalf to operate the Service. On termination, we
            will provide an export of your data in a reasonable format.
          </p>
        </section>

        <section className="mt-8 space-y-4">
          <h2 className="text-xl font-semibold text-eq-ink">5. What you may not do</h2>
          <p>You must not, and must not permit any third party to:</p>
          <ul className="list-disc pl-6 space-y-1.5">
            <li>copy, reproduce, distribute, sublicense or resell the Service or any part of it;</li>
            <li>reverse-engineer, decompile, disassemble, or otherwise attempt to derive the source code, schema, or underlying logic of the Service;</li>
            <li>remove, obscure or alter any EQ branding, copyright notices, trade marks or ownership attribution displayed in the Service;</li>
            <li>use the Service to build a competing product or to train machine-learning models that reproduce the Service;</li>
            <li>use the Service in breach of any law or third-party right.</li>
          </ul>
        </section>

        <section className="mt-8 space-y-4">
          <h2 className="text-xl font-semibold text-eq-ink">6. Confidentiality</h2>
          <p>
            The Service, including its workflows, layouts, pricing logic,
            API surfaces and any non-public technical documentation, is
            confidential to EQ. You must treat it with at least the same
            care as you would your own confidential information.
          </p>
        </section>

        <section className="mt-8 space-y-4">
          <h2 className="text-xl font-semibold text-eq-ink">7. No warranty; liability</h2>
          <p>
            To the extent permitted by law, the Service is provided
            &quot;as is&quot;, and EQ&apos;s liability is limited to the
            amount paid for the Service in the twelve months preceding the
            event giving rise to the claim. Nothing in these Terms limits
            rights you may have under the Australian Consumer Law that
            cannot be excluded.
          </p>
        </section>

        <section className="mt-8 space-y-4">
          <h2 className="text-xl font-semibold text-eq-ink">8. Governing law</h2>
          <p>
            These Terms are governed by the laws of the Commonwealth of
            Australia. The courts of Australia have exclusive jurisdiction
            over any dispute arising out of or in connection with the
            Service.
          </p>
        </section>

        <section className="mt-8 space-y-4">
          <h2 className="text-xl font-semibold text-eq-ink">9. Contact</h2>
          <p>
            For any queries about these Terms or the Service, contact EQ
            at{' '}
            <a className="text-eq-deep underline" href="mailto:hello@eq.solutions">
              hello@eq.solutions
            </a>
            .
          </p>
        </section>

        <p className="mt-10 text-xs text-gray-400">
          © 2026 EQ · CDC Solutions Pty Ltd · ABN 40 651 962 935. All rights reserved.
        </p>
      </main>

      <EqFooter />
    </div>
  )
}
