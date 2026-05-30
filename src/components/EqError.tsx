// EqError — readable error UI with optional retry button.

import { useState } from 'react';

interface EqErrorProps {
  title?: string;
  message: string;
  /**
   * Retry handler. May be sync or return a Promise. While an async retry is
   * in flight the button is disabled and shows a busy label so repeated
   * clicks can't fire duplicate fetches.
   */
  onRetry?: () => void | Promise<void>;
  /** Accessible label for the retry button. Defaults to "Try again". */
  retryLabel?: string;
}

export function EqError({
  title = 'Something went wrong',
  message,
  onRetry,
  retryLabel = 'Try again',
}: EqErrorProps) {
  const [retrying, setRetrying] = useState(false);

  const handleRetry = async () => {
    if (retrying || !onRetry) return;
    try {
      setRetrying(true);
      await onRetry();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="eq-error" role="alert">
      <p className="eq-error__title">{title}</p>
      <p className="eq-error__body">{message}</p>
      {onRetry && (
        <button
          type="button"
          className="eq-error__retry"
          onClick={handleRetry}
          disabled={retrying}
          aria-label={retryLabel}
          aria-busy={retrying}
        >
          {retrying ? (
            <>
              <span className="eq-error__spinner" aria-hidden="true" />
              Trying…
            </>
          ) : (
            retryLabel
          )}
        </button>
      )}
    </div>
  );
}
