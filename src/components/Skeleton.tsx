// Skeleton — compatibility shim over @eq-solutions/ui Skeleton.
//
// Maps Shell's original `variant` prop to the canonical `shape` prop:
//   'row'  → 'text'  (table-row loading placeholder — closest match)
//   'card' → 'card'
//   'text' → 'text'
// All other props (width, height, count) pass through unchanged.

import { Skeleton as PkgSkeleton, type SkeletonShape } from '@eq-solutions/ui';

type ShellVariant = 'row' | 'card' | 'text';

interface SkeletonProps {
  variant?: ShellVariant;
  width?: string | number;
  height?: string | number;
  count?: number;
}

const VARIANT_TO_SHAPE: Record<ShellVariant, SkeletonShape> = {
  row: 'text',
  card: 'card',
  text: 'text',
};

export function Skeleton({ variant = 'row', width, height, count = 1 }: SkeletonProps) {
  return (
    <PkgSkeleton
      shape={VARIANT_TO_SHAPE[variant]}
      width={width}
      height={height}
      count={count}
    />
  );
}
