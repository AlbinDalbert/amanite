import type { FractalCommandResult } from "@/lib/fractal/types";

type CommandStatusProps = {
  error: string | null;
  result: FractalCommandResult | null;
};

function CommandStatus({ error, result }: CommandStatusProps) {
  if (error) {
    return <p className="status-message error">{error}</p>;
  }

  if (!result) {
    return null;
  }

  return (
    <p className={result.ok ? "status-message success" : "status-message error"}>
      <span>{result.message}</span>
      {result.details ? <small>{result.details}</small> : null}
    </p>
  );
}

export default CommandStatus;
