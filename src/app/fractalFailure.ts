import type { FractalCommandError } from "@/lib/fractal/types";

export type FractalFailureStatus = "conflict" | "recovery_required" | "inspection_required" | "committed" | "unsupported_version" | "operation_error";

export function describeFractalFailure(error: FractalCommandError): { message: string; refresh: boolean; status: FractalFailureStatus } {
  switch (error.code) {
    case "conflict": return { message: `This page changed on disk. ${error.message}`, refresh: false, status: "conflict" };
    case "recovery_required": return { message: `Project recovery is required before more changes can be made. ${error.message}`, refresh: false, status: "recovery_required" };
    case "indeterminate": return { message: `The project state is uncertain and needs inspection. ${error.message}`, refresh: true, status: "inspection_required" };
    case "mutation_committed": return { message: `The files changed, but Fractal could not reload the project. ${error.message}`, refresh: true, status: "committed" };
    case "unsupported_version": return { message: `This project uses an unsupported Fractal version. Amanite cannot migrate it. ${error.message}`, refresh: false, status: "unsupported_version" };
    default: return { message: error.message, refresh: false, status: "operation_error" };
  }
}
