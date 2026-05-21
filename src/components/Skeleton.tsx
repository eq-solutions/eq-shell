// Skeleton loading placeholder. Beats "Loading…" plain text.

interface SkeletonProps {
  variant?: 'row' | 'card' | 'text';
  width?: string | number;
  height?: string | number;
  count?: number;
}

export function Skeleton({ variant = 'row', width, height, count = 1 }: SkeletonProps) {
  const style: React.CSSProperties = {};
  if (width !== undefined) style.width = typeof width === 'number' ? `${width}px` : width;
  if (height !== undefined) style.height = typeof height === 'number' ? `${height}px` : height;

  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          className={`eq-skeleton eq-skeleton--${variant}`}
          style={style}
          aria-hidden="true"
        />
      ))}
    </>
  );
}
