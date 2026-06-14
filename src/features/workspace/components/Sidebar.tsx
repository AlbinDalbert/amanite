import type { FractalPage } from "@/lib/fractal/types";
import FileExplorer from "./FileExplorer";

type SidebarProps = {
  activePagePath: string;
  canDeletePage: boolean;
  isBusy: boolean;
  pages: FractalPage[];
  projectName: string;
  onBuildIndex: () => void;
  onCreatePage: (pagePath: string) => void;
  onDeletePage: (pagePath: string) => void;
  onRenamePage: (pagePath: string, nextPagePath: string) => void;
  onSelectPage: (pagePath: string) => void;
  onValidate: () => void;
};

function Sidebar({
  activePagePath,
  canDeletePage,
  isBusy,
  pages,
  projectName,
  onBuildIndex,
  onCreatePage,
  onDeletePage,
  onRenamePage,
  onSelectPage,
  onValidate
}: SidebarProps) {
  function handleCreatePage() {
    const pagePath = window.prompt("New page path", "untitled");

    if (pagePath) {
      onCreatePage(pagePath);
    }
  }

  return (
    <aside
      className="sidebar"
      aria-label="File explorer"
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <div>
          <h1>Amanite</h1>
          <p>{projectName}</p>
        </div>
      </div>

      <div className="explorer-header">
        <span>Pages</span>
        <button
          type="button"
          aria-label="Create page"
          disabled={isBusy}
          onClick={handleCreatePage}
        >
          +
        </button>
      </div>

      <nav className="file-explorer" aria-label="Project files">
        <FileExplorer
          activePagePath={activePagePath}
          canDeletePage={canDeletePage}
          isBusy={isBusy}
          pages={pages}
          onBuildIndex={onBuildIndex}
          onCreatePage={onCreatePage}
          onDeletePage={onDeletePage}
          onRenamePage={onRenamePage}
          onSelectPage={onSelectPage}
          onValidate={onValidate}
        />
      </nav>
    </aside>
  );
}

export default Sidebar;
