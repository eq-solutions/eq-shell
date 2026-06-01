// Placeholder for modules that are entitled but not yet built. Honest
// about what's coming + when so users don't feel like the link was a
// dead end. Wrapped in HubLayout so the user isn't trapped.

import { Link, useParams } from 'react-router-dom';
import { HubLayout } from '../components/HubLayout';

export interface ComingSoonProps {
  module: string;
  /**
   * Optional short blurb describing what this module will do once it
   * ships. If omitted, falls back to a generic message.
   */
  description?: string;
  /**
   * Optional bullet points of features in flight. Helps users
   * calibrate expectations vs. the "Live" modules.
   */
  features?: string[];
  /**
   * Optional rough timing estimate ("Q3 2026", "after Field MT").
   * Skip if you'd rather not commit to one.
   */
  eta?: string;
}

export default function ComingSoon({ module, description, features, eta }: ComingSoonProps) {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  return (
    <HubLayout>
        <div className="eq-page__header">
          <span
            className="eq-pill eq-pill--info"
            style={{ display: 'inline-block', marginBottom: 12 }}
          >
            Coming soon
          </span>
          <h1 className="eq-page__title">{module}</h1>
          <p className="eq-page__lede">
            {description ??
              `${module} is in development. It's part of the EQ Shell roadmap and will land here once the spec is locked.`}
          </p>
        </div>

        {features && features.length > 0 && (
          <section className="eq-section">
            <h2 className="eq-section__heading">What's in flight</h2>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {features.map((f) => (
                <li
                  key={f}
                  style={{
                    padding: '12px 16px',
                    border: '1px solid var(--eq-border)',
                    borderRadius: 6,
                    marginBottom: 8,
                    fontSize: 14,
                    color: 'var(--eq-ink)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 9999,
                      background: 'var(--eq-sky)',
                      flexShrink: 0,
                    }}
                  />
                  {f}
                </li>
              ))}
            </ul>
          </section>
        )}

        {eta && (
          <section className="eq-section">
            <h2 className="eq-section__heading">Rough timing</h2>
            <p style={{ color: 'var(--eq-grey)', fontSize: 14 }}>{eta}</p>
          </section>
        )}

        <section className="eq-section" style={{ marginTop: 48 }}>
          <Link
            to={`/${tenantSlug}`}
            className="eq-btn eq-btn--ghost eq-btn--md"
            style={{ textDecoration: 'none' }}
          >
            ← Back to home
          </Link>
        </section>
    </HubLayout>
  );
}
