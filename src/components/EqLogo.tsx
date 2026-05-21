// EQ wordmark / mark — inline SVG so no asset fetch.
// Sky-blue square with white "EQ" letterform.

import type { JSX } from 'react';

interface EqLogoProps {
  size?: number;
  className?: string;
  variant?: 'mark' | 'wordmark';
}

export function EqLogo({ size = 32, className, variant = 'mark' }: EqLogoProps): JSX.Element {
  if (variant === 'wordmark') {
    return (
      <span className={className} style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
        <EqLogo size={size} variant="mark" />
        <span style={{ fontWeight: 700, fontSize: size * 0.55, letterSpacing: '-0.02em' }}>EQ Solutions</span>
      </span>
    );
  }
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect width="48" height="48" rx="9" fill="var(--eq-brand)" />
      <path
        d="M14 13h10v3.4h-6.4v3.6h5.8v3.4h-5.8v3.8h6.6v3.4H14V13z"
        fill="white"
      />
      <path
        d="M34.6 31.4l-1.8-2.2c-.9.5-1.9.8-3 .8-2.2 0-3.7-1.2-4-3.2-.1-.4-.1-.8-.1-1.6 0-.7 0-1.1.1-1.5.3-2 1.8-3.2 4-3.2s3.7 1.2 4 3.2c.1.4.1.8.1 1.5 0 .7 0 1.2-.1 1.6-.1.5-.2 1-.4 1.3l1.7 2.1-2.5.2v1zm-4.8-2.9c.9 0 1.4-.4 1.6-1.1.1-.3.1-.5.1-1.2 0-.7 0-.9-.1-1.2-.2-.7-.7-1.1-1.6-1.1s-1.4.4-1.6 1.1c-.1.3-.1.5-.1 1.2 0 .7 0 .9.1 1.2.2.7.7 1.1 1.6 1.1z"
        fill="white"
      />
    </svg>
  );
}
