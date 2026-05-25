import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

export function RouteProgressBar() {
  const location = useLocation();
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle');
  const prevPath = useRef(location.pathname);
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (location.pathname === prevPath.current) return;
    prevPath.current = location.pathname;

    if (doneTimer.current) clearTimeout(doneTimer.current);

    setPhase('running');
    doneTimer.current = setTimeout(() => {
      setPhase('done');
      doneTimer.current = setTimeout(() => setPhase('idle'), 200);
    }, 300);

    return () => {
      if (doneTimer.current) clearTimeout(doneTimer.current);
    };
  }, [location.pathname]);

  if (phase === 'idle') return null;

  return (
    <div
      className={`eq-progress-bar eq-progress-bar--${phase}`}
      role="progressbar"
      aria-hidden="true"
    />
  );
}
