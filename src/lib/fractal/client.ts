import { invoke } from "@tauri-apps/api/core";
import type { FractalClient, FractalCommandResult, FractalProject } from "./types";

function hasTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

async function invokeFractal<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!hasTauriRuntime()) {
    throw new Error("Amanite must be run through Tauri to load local Fractal project files.");
  }

  return invoke<T>(command, args);
}

export const fractalClient: FractalClient = {
  createProject() {
    return invokeFractal<FractalProject>("fractal_create_project");
  },
  openProject() {
    return invokeFractal<FractalProject>("fractal_open_project");
  },
  validateProject(project) {
    return invokeFractal<FractalCommandResult>("fractal_validate_project", {
      projectRoot: project.rootPath
    });
  },
  buildIndex(project) {
    return invokeFractal<FractalCommandResult>("fractal_build_index", {
      projectRoot: project.rootPath
    });
  }
};
