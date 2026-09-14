import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_APPEARANCE_SETTINGS, type AppearanceSettings } from "@/app/useAppearanceSettings";
import type { AiSettings } from "@/app/useAiSettings";
import type { FractalProject } from "@/lib/fractal/types";
import Workspace from "./Workspace";

vi.mock("@/features/ai-chat/components/AiChat", () => ({
  default: () => <div data-testid="borealis-chat" />,
  BorealisSessionProvider: ({ children }: { children: ReactNode }) => <>{children}</>
}));

vi.mock("./CommandStatus", () => ({ default: () => null }));
vi.mock("./EditorGroupPane", () => ({ default: ({ group }: { group: { id: string } }) => <div data-testid={`editor-group-${group.id}`} /> }));
vi.mock("./Sidebar", () => ({ default: () => <aside data-testid="sidebar" /> }));
vi.mock("./WorkspaceTabs", () => ({ default: ({ group }: { group: { id: string } }) => <div data-testid={`tabs-${group.id}`} /> }));
vi.mock("./WorkspaceToolbar", () => ({ default: ({ tabs }: { tabs: ReactNode }) => <header data-testid="toolbar">{tabs}</header> }));

const project: FractalProject = {
  name: "Test project",
  version: 2,
  rootPath: "/tmp/test-project",
  pages: [],
  folders: [],
  activePagePath: null,
  activePageSource: null,
  activePageLinks: [],
  activePageBacklinks: []
};

const aiSettings: AiSettings = { endpoint: "", apiKey: "", model: "" };
const settings: AppearanceSettings = DEFAULT_APPEARANCE_SETTINGS;

function props() {
  return {
    aiSettings,
    commandResult: null,
    error: null,
    isBusy: false,
    project,
    settings,
    onCloseProject: vi.fn(),
    onCloseRequest: vi.fn(),
    onCreateFolder: vi.fn(async () => null),
    onCreatePage: vi.fn(async () => null),
    onSetFolderTitle: vi.fn(async () => null),
    onReorderFolder: vi.fn(async () => null),
    onDeletePage: vi.fn(async () => null),
    onDeleteFolder: vi.fn(async () => null),
    onDismissStatus: vi.fn(),
    onDuplicatePage: vi.fn(async () => null),
    onRepairPage: vi.fn(async () => null),
    onMovePage: vi.fn(async () => null),
    onOpenSettings: vi.fn(),
    onProjectSnapshot: vi.fn(),
    onRegisterWorkspace: vi.fn(),
    onRequestConfirmation: vi.fn(async () => false),
    onRevealPage: vi.fn(),
    onValidate: vi.fn()
  };
}

describe("workspace composition", () => {
  it("mounts the workspace shell with its sidebar, toolbar, and editor group", () => {
    const html = renderToStaticMarkup(<Workspace {...props()} />);

    expect(html).toContain("data-testid=\"sidebar\"");
    expect(html).toContain("data-testid=\"toolbar\"");
    expect(html).toContain("data-testid=\"tabs-left\"");
    expect(html).toContain("data-testid=\"editor-group-left\"");
  });
});
