import { describe, expect, it } from "vitest";
import type { FractalCommandError } from "@/lib/fractal/types";
import { describeFractalFailure } from "./useFractalSession";

function failure(code: FractalCommandError["code"]) {
  return describeFractalFailure({ code, message: "Operation detail." });
}

describe("Fractal failure policy", () => {
  it.each([
    ["conflict", "conflict", false, "changed on disk"],
    ["recovery_required", "recovery_required", false, "recovery is required"],
    ["indeterminate", "inspection_required", true, "needs inspection"],
    ["mutation_committed", "committed", true, "files changed"],
    ["unsupported_version", "unsupported_version", false, "cannot migrate it"]
  ] as const)("maps %s to its application status", (code, status, refresh, message) => {
    expect(failure(code)).toEqual({
      message: expect.stringContaining(message),
      refresh,
      status
    });
  });

  it("keeps ordinary Fractal errors actionable", () => {
    expect(failure("invalid_input")).toEqual({
      message: "Operation detail.",
      refresh: false,
      status: "operation_error"
    });
  });
});
