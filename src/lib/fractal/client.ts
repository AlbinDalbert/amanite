import { invoke } from "@tauri-apps/api/core";
import { mockProject } from "./mockProject";
import type { FractalClient, FractalCommandResult, FractalProject } from "./types";

type InvokeArgs = Record<string, unknown>;

function cloneMockProject(): FractalProject {
  return {
    ...mockProject,
    theme: { ...mockProject.theme },
    pages: mockProject.pages.map((page) => ({ ...page }))
  };
}

function hasTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

async function invokeFractal<T>(
  command: string,
  args: InvokeArgs,
  fallback: () => T
): Promise<T> {
  if (!hasTauriRuntime()) {
    return fallback();
  }

  try {
    return await invoke<T>(command, args);
  } catch (error) {
    console.warn(`Falling back to mock Fractal data after ${command} failed.`, error);
    return fallback();
  }
}

function mockCommand(message: string): FractalCommandResult {
  return {
    ok: true,
    message,
    details: "Mock response. Wire the matching Tauri command to call the Fractal crate."
  };
}

export const fractalClient: FractalClient = {
  createProject() {
    return invokeFractal("fractal_create_project", {}, cloneMockProject);
  },
  openProject() {
    return invokeFractal("fractal_open_project", {}, cloneMockProject);
  },
  validateProject(project) {
    return invokeFractal(
      "fractal_validate_project",
      { projectRoot: project.rootPath },
      () => mockCommand("Project validation completed.")
    );
  },
  buildIndex(project) {
    return invokeFractal(
      "fractal_build_index",
      { projectRoot: project.rootPath },
      () => mockCommand("Project index built.")
    );
  }
};
