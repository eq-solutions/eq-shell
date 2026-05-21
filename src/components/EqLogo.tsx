// EQ logo — canonical SVG, two approved variants only.
//
// Source: eq-solutions-design.prompt.md §LOGO RULES.
//   blue:  /eq-logo-blue.svg   — for light surfaces (default)
//   white: /eq-logo-white.svg  — for dark surfaces (--eq-ink bg, modals)
//
// Hard rules from the spec:
//   - Never recolour, stretch, skew, shadow, outline, or gradient
//   - Minimum size 24px, clear space = logo height
//   - Never on busy photography
//   - No black variant
//
// The blue SVG paints with #3DA8D8 internally; the white SVG with #FFFFFF.
// Both are square (viewBox 0 0 1024 1024).

import type { JSX } from 'react';

interface EqLogoProps {
  size?: number;
  className?: string;
  variant?: 'mark' | 'wordmark';
  onDark?: boolean;
}

export function EqLogo({
  size = 32,
  className,
  variant = 'mark',
  onDark = false,
}: EqLogoProps): JSX.Element {
  const src = onDark ? '/eq-logo-white.svg' : '/eq-logo-blue.svg';

  if (variant === 'wordmark') {
    return (
      <span className={className} style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
        <img
          src={src}
          width={size}
          height={size}
          alt="EQ Solutions"
          style={{ display: 'block' }}
        />
        <span
          style={{
            fontWeight: 700,
            fontSize: size * 0.5,
            letterSpacing: '-0.02em',
            color: onDark ? 'var(--eq-white)' : 'var(--eq-ink)',
          }}
        >
          EQ Solutions
        </span>
      </span>
    );
  }
  return (
    <img
      className={className}
      src={src}
      width={size}
      height={size}
      alt="EQ Solutions"
      style={{ display: 'block' }}
    />
  );
}
