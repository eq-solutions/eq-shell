// EqError — readable error UI with optional retry button.

interface EqErrorProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

export function EqError({ title = 'Something went wrong', message, onRetry }: EqErrorProps) {
  return (
    <div className="eq-error" role="alert">
      <p className="eq-error__title">{title}</p>
      <p className="eq-error__body">{message}</p>
      {onRetry && (
        <button type="button" className="eq-error__retry" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
