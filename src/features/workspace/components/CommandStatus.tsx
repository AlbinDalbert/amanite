import type { FractalCommandResult } from "@/lib/fractal/types";

type CommandStatusProps = {
  error: string | null;
  result: FractalCommandResult | null;
  onDismiss: () => void;
};

function CommandStatus({ error, result, onDismiss }: CommandStatusProps) {
  if (error) {
    return (
      <button className="status-message error" onClick={onDismiss} type="button">
        {error}
      </button>
    );
  }

  if (!result) {
    return null;
  }

  return (
    <button
      className={result.ok ? "status-message success" : "status-message error"}
      onClick={onDismiss}
      type="button"
    >
      <span>{result.message}</span>
      {result.details ? <small>{result.details}</small> : null}
    </button>
  );
}

export default CommandStatus;
